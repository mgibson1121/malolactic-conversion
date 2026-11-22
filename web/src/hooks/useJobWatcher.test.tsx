import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import type { EnrichmentJobs, WineEntry } from '@shared/types'
import { useJobWatcher } from './useJobWatcher'
import { getWine } from '../api'
import { JOB_POLL_MS, JOB_WATCH_MAX_MS } from '../constants'
import { makeTestWine } from '../test-fixtures'

vi.mock('../api', () => ({ getWine: vi.fn() }))
const mockGetWine = getWine as unknown as ReturnType<typeof vi.fn>

const job = (state: 'running' | 'done', done = 0): EnrichmentJobs => ({
  reviews: { state, stage: 'shops', started_at: 'a', updated_at: 'b', shops_total: 11, shops_done: done, scores_found: 0, identity: 'k' },
})
const running = (done = 0) => makeTestWine({ enrichment_job: job('running', done) })

beforeEach(() => {
  vi.useFakeTimers()
  mockGetWine.mockReset()
})
afterEach(() => vi.useRealTimers())

async function tick(times = 1) {
  for (let i = 0; i < times; i++) await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MS) })
}

describe('useJobWatcher (Phase 14 WI-6)', () => {
  it('reads the wine every few seconds while its search is running, and hands over what changed', async () => {
    const seen: WineEntry[] = []
    mockGetWine.mockResolvedValue(running(5))
    renderHook(() => useJobWatcher(running(0), false, (w) => seen.push(w)))
    await tick()
    expect(mockGetWine).toHaveBeenCalledWith('wine-1')
    expect(seen).toHaveLength(1)
    expect(seen[0].enrichment_job?.reviews?.shops_done).toBe(5)
  })

  it('does nothing for a wine with no search running', async () => {
    renderHook(() => useJobWatcher(makeTestWine(), false, () => {}))
    await tick(3)
    expect(mockGetWine).not.toHaveBeenCalled()
  })

  it("is active while this screen's own request is out, even before the server has said a search is running", async () => {
    mockGetWine.mockResolvedValue(makeTestWine())
    renderHook(() => useJobWatcher(makeTestWine(), true, () => {}))
    await tick(2)
    expect(mockGetWine).toHaveBeenCalledTimes(2)
  })

  it('stops reading once the search has ended', async () => {
    let wine = running(0)
    mockGetWine.mockResolvedValue(makeTestWine({ enrichment_job: job('done', 11) }))
    const { rerender } = renderHook(() => useJobWatcher(wine, false, (w) => { wine = w }))
    await tick()
    rerender()
    const reads = mockGetWine.mock.calls.length
    await tick(3)
    expect(mockGetWine.mock.calls.length).toBe(reads)
  })

  it('does not re-hand the same answer: an unchanged read changes nothing', async () => {
    const onWine = vi.fn()
    mockGetWine.mockResolvedValue(running(0))
    renderHook(() => useJobWatcher(running(0), false, onWine))
    await tick(3)
    expect(onWine).not.toHaveBeenCalled()
  })

  it("brings across a lookup's fields only, never the developer's own", async () => {
    const mine = { ...running(0), tag_wishlist: true, cellar_quantity: 9 }
    mockGetWine.mockResolvedValue({ ...running(4), tag_wishlist: false, cellar_quantity: 1 })
    const onWine = vi.fn()
    renderHook(() => useJobWatcher(mine, false, onWine))
    await tick()
    const merged = onWine.mock.calls[0][0] as WineEntry
    expect(merged.tag_wishlist).toBe(true)
    expect(merged.cellar_quantity).toBe(9)
    expect(merged.enrichment_job?.reviews?.shops_done).toBe(4)
  })

  it('drops a read that began before the wine last changed, so an old answer never covers a newer one', async () => {
    let release!: (w: WineEntry) => void
    mockGetWine.mockReturnValueOnce(new Promise<WineEntry>((resolve) => { release = resolve }))
    const onWine = vi.fn()
    let current = running(0)
    const { rerender } = renderHook(() => useJobWatcher(current, false, onWine))
    await tick() // the read is out
    current = running(9) // the wine changed meanwhile (say, this screen's own request returned)
    rerender()
    await act(async () => { release(running(2)); await Promise.resolve() })
    expect(onWine).not.toHaveBeenCalled()
  })

  it('a failed read is not the end of the search: it tries again', async () => {
    const onWine = vi.fn()
    mockGetWine.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(running(6))
    renderHook(() => useJobWatcher(running(0), false, onWine))
    await tick(2)
    expect(onWine).toHaveBeenCalledTimes(1)
  })

  it('follows one search for five minutes at most', async () => {
    mockGetWine.mockResolvedValue(running(0))
    renderHook(() => useJobWatcher(running(0), false, () => {}))
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_WATCH_MAX_MS + JOB_POLL_MS) })
    const reads = mockGetWine.mock.calls.length
    await tick(5)
    expect(mockGetWine.mock.calls.length).toBe(reads)
    expect(reads).toBeLessThanOrEqual(JOB_WATCH_MAX_MS / JOB_POLL_MS + 1)
  })

  it('stops when the screen goes away', async () => {
    mockGetWine.mockResolvedValue(running(0))
    const { unmount } = renderHook(() => useJobWatcher(running(0), false, () => {}))
    await tick()
    unmount()
    const reads = mockGetWine.mock.calls.length
    await tick(3)
    expect(mockGetWine.mock.calls.length).toBe(reads)
  })
})
