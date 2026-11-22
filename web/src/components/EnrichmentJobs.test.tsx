/**
 * Phase 14 WI-6: a running search is shown as running wherever the wine
 * appears, scores arrive under a skeleton, and nothing is click-gated.
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { EnrichmentJobs, PriceJob, ReviewsJob, WineEntry } from '@shared/types'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { useEnrichmentAction } from '../hooks/useEnrichmentAction'
import { CriticReviewsBlock, criticReviewsState } from './CriticReviewsBlock'
import { PriceBlock } from './PriceSection'
import { WineCard } from './WineCard'
import { getWine, fetchWinePrice, fetchWineReviews } from '../api'
import { makeSummaryItem, makeTestPriceData, makeTestRetailer, makeTestWine } from '../test-fixtures'

vi.mock('../api', () => ({
  getWine: vi.fn(),
  fetchWinePrice: vi.fn(),
  fetchWineReviews: vi.fn(),
  resolveRetailerUrl: vi.fn(),
}))
const mockGetWine = vi.mocked(getWine)
const mockFetchPrice = vi.mocked(fetchWinePrice)
const mockFetchReviews = vi.mocked(fetchWineReviews)

const idle: EnrichmentAction = { busy: false, error: null, cachedAt: null, run: vi.fn() }
const reviewsJob = (over: Partial<ReviewsJob> = {}): ReviewsJob => ({
  state: 'running', stage: 'shops', started_at: 'a', updated_at: 'b', shops_total: 11, shops_done: 0, scores_found: 0, identity: 'k', ...over,
})
const priceJob = (over: Partial<PriceJob> = {}): PriceJob => ({ state: 'running', started_at: 'a', updated_at: 'b', identity: 'k', ...over })
const jobs = (reviews?: ReviewsJob | null, price?: PriceJob | null): EnrichmentJobs => ({ reviews, price })
const ladder = (tier: '1' | '2') => ({
  tier, pages: [], rungs: [{ tier, pages: 1, scores: 1, trusted_scores: 1, critics: ['Vinous'], vintages: [2019] }],
})
const withScore = (over: Partial<WineEntry> = {}) =>
  makeTestWine({ critic_summary: { ordered: [makeSummaryItem({ publication: 'Vinous', score: 94 })] }, review_ladder: ladder('2'), ...over })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetWine.mockReset()
})

describe('critic block while a search runs (spec D4)', () => {
  it('scores stay on screen above a skeleton that says how many shops are left', () => {
    render(<CriticReviewsBlock wine={withScore({ enrichment_job: jobs(reviewsJob({ shops_done: 7, scores_found: 2 })) })} action={idle} />)
    expect(screen.getByText('Vinous')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Checked 7 of 11 shops · 2 scores so far')
  })

  it('once the last shop is in, the skeleton goes and the line says how many were checked', () => {
    render(<CriticReviewsBlock wine={withScore({ enrichment_job: jobs(reviewsJob({ state: 'done', shops_done: 11, scores_found: 3 })) })} action={idle} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('search-meta')).toHaveTextContent('Checked 11 shops')
  })

  it('does not announce a tier while shops are unfinished, and says what it is still looking for', () => {
    render(<CriticReviewsBlock wine={withScore({ enrichment_job: jobs(reviewsJob({ shops_done: 3 })) })} action={idle} />)
    expect(screen.queryByTestId('tier-marker')).not.toBeInTheDocument()
    expect(screen.getByTestId('tier-looking')).toHaveTextContent('Looking for an exact-vintage score…')
  })

  it('and stops saying it once an exact-vintage score is in', () => {
    render(<CriticReviewsBlock wine={withScore({ review_ladder: ladder('1'), enrichment_job: jobs(reviewsJob({ shops_done: 3 })) })} action={idle} />)
    expect(screen.queryByTestId('tier-looking')).not.toBeInTheDocument()
  })

  it('shows the tier once the search has ended', () => {
    render(<CriticReviewsBlock wine={withScore({ enrichment_job: jobs(reviewsJob({ state: 'done', shops_done: 11 })) })} action={idle} />)
    expect(screen.getByTestId('tier-marker')).toBeInTheDocument()
    expect(screen.queryByTestId('tier-looking')).not.toBeInTheDocument()
  })

  it('"Which bottling is yours?" waits for the search to end, so a partial result never asks a question', () => {
    const prompt = { reasons: ['modifiers' as const], signature: 's', options: [{ name: 'A', words: ['a'], retailers: [], critics: [], price_range: null, links: [], count: 1 }] }
    const { rerender } = render(
      <CriticReviewsBlock wine={withScore({ bottling_prompt: prompt, enrichment_job: jobs(reviewsJob({ shops_done: 3 })) })} action={idle} onWineUpdated={() => {}} />
    )
    expect(screen.queryByTestId('bottling-banner')).not.toBeInTheDocument()
    rerender(<CriticReviewsBlock wine={withScore({ bottling_prompt: prompt, enrichment_job: jobs(reviewsJob({ state: 'done', shops_done: 11 })) })} action={idle} onWineUpdated={() => {}} />)
    expect(screen.getByTestId('bottling-banner')).toBeInTheDocument()
  })

  it('a wine saved mid-search is looking, never "not looked up yet" (F4)', () => {
    const wine = makeTestWine({ enrichment_job: jobs(reviewsJob({ shops_done: 2 })) })
    expect(criticReviewsState(wine, idle)).toBe('looking')
    render(<CriticReviewsBlock wine={wine} action={idle} />)
    expect(screen.getByRole('status')).toHaveTextContent('Checked 2 of 11 shops')
    expect(screen.queryByText(/haven’t been looked up/)).not.toBeInTheDocument()
  })

  it('a running search outranks "nothing found" on a wine that has stored review data', () => {
    expect(criticReviewsState(makeTestWine({ review_data: [], enrichment_job: jobs(reviewsJob()) }), idle)).toBe('looking')
  })

  it('nothing found says how many shops were checked, with no button', () => {
    render(<CriticReviewsBlock wine={makeTestWine({ review_data: [], enrichment_job: jobs(reviewsJob({ state: 'done', shops_done: 11 })) })} action={idle} />)
    expect(screen.getByText('No critic scores found at 11 shops.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('a search the server stopped says so and offers Retry, which runs it again', async () => {
    const run = vi.fn()
    const wine = makeTestWine({ enrichment_job: jobs(reviewsJob({ state: 'interrupted', shops_done: 3 })) })
    expect(criticReviewsState(wine, idle)).toBe('failed')
    render(<CriticReviewsBlock wine={wine} action={{ ...idle, run }} />)
    expect(screen.getByText(/stopped before every shop was checked/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(run).toHaveBeenCalled()
  })

  it('a search that could not run reads as a failure', () => {
    expect(criticReviewsState(makeTestWine({ enrichment_job: jobs(reviewsJob({ state: 'failed' })) }), idle)).toBe('failed')
  })
})

describe('price block while a lookup runs (WI-5)', () => {
  const noop = () => {}

  it('no price yet: the skeleton, also for a lookup this screen did not start', () => {
    render(<PriceBlock wine={makeTestWine({ enrichment_job: jobs(null, priceJob()) })} action={idle} onWineUpdated={noop} />)
    expect(screen.getByRole('status')).toHaveTextContent('Checking prices…')
    expect(screen.queryByText('No price data yet.')).not.toBeInTheDocument()
  })

  it('a refresh over stored prices says so and leaves them on screen', () => {
    const wine = makeTestWine({ price_data: makeTestPriceData([makeTestRetailer({ price: 100 })]), enrichment_job: jobs(null, priceJob()) })
    render(<PriceBlock wine={wine} action={idle} onWineUpdated={noop} />)
    expect(screen.getByRole('status')).toHaveTextContent('Checking prices…')
    expect(screen.getByTestId('price-state-line')).toBeInTheDocument()
  })

  it('both buttons wait for the running lookup (no second one)', () => {
    const wine = makeTestWine({ price_data: makeTestPriceData([makeTestRetailer()]), enrichment_job: jobs(null, priceJob()) })
    render(<PriceBlock wine={wine} action={idle} onWineUpdated={noop} />)
    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Hard refresh' })).toBeDisabled()
  })

  it('a lookup that failed or was stopped says so, with Retry', async () => {
    const run = vi.fn()
    render(<PriceBlock wine={makeTestWine({ enrichment_job: jobs(null, priceJob({ state: 'interrupted' })) })} action={{ ...idle, run }} onWineUpdated={noop} />)
    expect(screen.getByText(/Couldn’t check prices\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(run).toHaveBeenCalled()
  })

  it('a finished lookup shows no running line', () => {
    const wine = makeTestWine({ price_data: makeTestPriceData([makeTestRetailer()]), enrichment_job: jobs(null, priceJob({ state: 'done' })) })
    render(<PriceBlock wine={wine} action={idle} onWineUpdated={noop} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('useEnrichmentAction with the wine\'s job (spec F5, F6)', () => {
  const mount = (wine: WineEntry, kind: 'reviews' | 'price', fetcher: typeof fetchWineReviews, onUpdated = vi.fn()) =>
    renderHook(() => useEnrichmentAction(wine.id, fetcher, onUpdated, 'Couldn’t check reviews', { wine, kind }))

  it('sends no second request while this wine\'s search is running', async () => {
    const { result } = mount(makeTestWine({ enrichment_job: jobs(reviewsJob()) }), 'reviews', mockFetchReviews)
    await act(async () => { await result.current.run() })
    await act(async () => { await result.current.run({ force: true }) })
    expect(mockFetchReviews).not.toHaveBeenCalled()
  })

  it("is not blocked by the other kind's job", async () => {
    mockFetchReviews.mockResolvedValue(makeTestWine())
    const { result } = mount(makeTestWine({ enrichment_job: jobs(null, priceJob()) }), 'reviews', mockFetchReviews)
    await act(async () => { await result.current.run() })
    expect(mockFetchReviews).toHaveBeenCalledTimes(1)
  })

  it('a request that fails while the server is still searching is not an error: the stored wine is taken instead', async () => {
    const onUpdated = vi.fn()
    const stillRunning = makeTestWine({ enrichment_job: jobs(reviewsJob({ shops_done: 4 })) })
    mockFetchReviews.mockRejectedValue(new Error('network'))
    mockGetWine.mockResolvedValue(stillRunning)
    const { result } = mount(makeTestWine(), 'reviews', mockFetchReviews, onUpdated)
    await act(async () => { await result.current.run() })
    expect(result.current.error).toBeNull()
    expect(onUpdated).toHaveBeenCalledWith(stillRunning)
  })

  it('a failure with nothing running on the server is shown as one', async () => {
    mockFetchReviews.mockRejectedValue(new Error('boom'))
    mockGetWine.mockResolvedValue(makeTestWine())
    const { result } = mount(makeTestWine(), 'reviews', mockFetchReviews)
    await act(async () => { await result.current.run() })
    expect(result.current.error).toBe('boom')
  })

  it('and so is one where even the stored wine cannot be read', async () => {
    mockFetchReviews.mockRejectedValue(new Error('offline'))
    mockGetWine.mockRejectedValue(new Error('offline'))
    const { result } = mount(makeTestWine(), 'reviews', mockFetchReviews)
    await act(async () => { await result.current.run() })
    expect(result.current.error).toBe('offline')
  })

  it('without a wine to watch it behaves as before (no recovery read)', async () => {
    mockFetchPrice.mockRejectedValue(new Error('x'))
    const { result } = renderHook(() => useEnrichmentAction('wine-1', fetchWinePrice, vi.fn(), 'Price lookup failed'))
    await act(async () => { await result.current.run() })
    expect(result.current.error).toBe('x')
    expect(mockGetWine).not.toHaveBeenCalled()
  })
})

describe('WineCard — a saved wine mid-search shows it and follows it', () => {
  const noop = () => {}
  const card = (wine: WineEntry, onWineUpdated: (w: WineEntry) => void = noop) =>
    render(
      <WineCard wine={wine} activeTab="Discovered" onEvaluate={noop} onTagUpdate={noop} onQuantityChange={noop}
        onViewHistory={noop} onWineUpdated={onWineUpdated} onViewDetail={noop} onEdit={noop} />
    )

  it('says Searching… with the count, and the Fetch button waits', () => {
    card(makeTestWine({ enrichment_job: jobs(reviewsJob({ shops_done: 6 })) }))
    expect(screen.getByTestId('card-searching')).toHaveTextContent('Searching… Checked 6 of 11 shops')
    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled()
  })

  it('shows nothing extra for a wine with no search running', () => {
    card(makeTestWine())
    expect(screen.queryByTestId('card-searching')).not.toBeInTheDocument()
  })

  it('a running price lookup shows it too', () => {
    card(makeTestWine({ enrichment_job: jobs(null, priceJob()) }))
    expect(screen.getByTestId('card-searching')).toBeInTheDocument()
  })

  it('reads the wine while it runs, and hands the list what it finds', async () => {
    vi.useFakeTimers()
    try {
      const onUpdated = vi.fn()
      mockGetWine.mockResolvedValue(withScore({ enrichment_job: jobs(reviewsJob({ state: 'done', shops_done: 11, scores_found: 1 })) }))
      card(makeTestWine({ enrichment_job: jobs(reviewsJob({ shops_done: 6 })) }), onUpdated)
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(onUpdated).toHaveBeenCalledTimes(1)
      expect((onUpdated.mock.calls[0][0] as WineEntry).critic_summary?.ordered).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not read the wine when no search is running', async () => {
    vi.useFakeTimers()
    try {
      card(makeTestWine())
      await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
      expect(mockGetWine).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
