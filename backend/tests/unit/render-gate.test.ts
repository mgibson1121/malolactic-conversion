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

// ── The shared browser (2026-11-03) ───────────────────────────────────────────
import { withSharedBrowser, closeSharedBrowser } from '@shared/utils/render-gate'

class FakeBrowser {
  connected = true
  closed = 0
  private onDisconnect: (() => void) | null = null
  once(_event: 'disconnected', handler: () => void) {
    this.onDisconnect = handler
    return this
  }
  async close() {
    this.closed++
    this.crash()
  }
  crash() {
    this.connected = false
    this.onDisconnect?.()
  }
}

describe('withSharedBrowser', () => {
  let launched: FakeBrowser[]
  const launch = jest.fn(async () => {
    const b = new FakeBrowser()
    launched.push(b)
    return b
  })

  beforeEach(() => {
    launched = []
    launch.mockClear()
  })
  afterEach(async () => {
    await closeSharedBrowser()
    delete process.env.BROWSER_IDLE_MS
    jest.useRealTimers()
  })

  it('launches once and reuses the browser across renders, including concurrent ones', async () => {
    const seen = await Promise.all([1, 2, 3].map(() => withSharedBrowser(launch, async (b) => b)))
    seen.push(await withSharedBrowser(launch, async (b) => b))
    expect(launch).toHaveBeenCalledTimes(1)
    expect(new Set(seen).size).toBe(1)
  })

  it('relaunches after the browser crashes', async () => {
    const first = await withSharedBrowser(launch, async (b) => b)
    first.crash()
    const second = await withSharedBrowser(launch, async (b) => b)
    expect(second).not.toBe(first)
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failed launch: the next render tries again', async () => {
    launch.mockRejectedValueOnce(new Error('no chromium'))
    await expect(withSharedBrowser(launch, async () => 'x')).rejects.toThrow('no chromium')
    expect(await withSharedBrowser(launch, async () => 'ok')).toBe('ok')
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('closes the browser after BROWSER_IDLE_MS with nothing to render, not while rendering', async () => {
    jest.useFakeTimers()
    process.env.BROWSER_IDLE_MS = '1000'
    await withSharedBrowser(launch, async () => null)
    jest.advanceTimersByTime(500)
    // A render inside the idle window cancels the close and reuses the browser.
    await withSharedBrowser(launch, async () => null)
    jest.advanceTimersByTime(999)
    expect(launched[0].closed).toBe(0)
    jest.advanceTimersByTime(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(launched[0].closed).toBe(1)
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('closeSharedBrowser closes once and is safe to repeat', async () => {
    await withSharedBrowser(launch, async () => null)
    await closeSharedBrowser()
    await closeSharedBrowser()
    expect(launched[0].closed).toBe(1)
  })
})
