// Phase 13 WI-1 — one process-wide cap on concurrent Chromium renders.
import { withRenderSlot, activeRenders } from '@shared/utils/render-gate'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const flush = () => new Promise((r) => setImmediate(r))

afterEach(() => {
  delete process.env.RENDER_CONCURRENCY
})

it('never runs more than RENDER_CONCURRENCY at once, and runs every queued render', async () => {
  process.env.RENDER_CONCURRENCY = '2'
  const gates = Array.from({ length: 5 }, deferred)
  let running = 0
  let peak = 0
  const done = gates.map((g, i) =>
    withRenderSlot(async () => {
      running++
      peak = Math.max(peak, running)
      await g.promise
      running--
      return i
    })
  )

  await flush()
  expect(running).toBe(2)
  for (const g of gates) {
    g.resolve()
    await flush()
  }
  expect(await Promise.all(done)).toEqual([0, 1, 2, 3, 4])
  expect(peak).toBe(2)
  expect(activeRenders()).toBe(0)
})

it('releases the slot when a render throws', async () => {
  process.env.RENDER_CONCURRENCY = '1'
  await expect(withRenderSlot(async () => { throw new Error('boom') })).rejects.toThrow('boom')
  expect(await withRenderSlot(async () => 'next')).toBe('next')
  expect(activeRenders()).toBe(0)
})

it('is uncapped when RENDER_CONCURRENCY is unset (local development)', async () => {
  const gates = Array.from({ length: 6 }, deferred)
  let running = 0
  const done = gates.map((g) => withRenderSlot(async () => { running++; await g.promise }))
  await flush()
  expect(running).toBe(6)
  gates.forEach((g) => g.resolve())
  await Promise.all(done)
})
