import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { CriticReviewsBlock, criticReviewsState } from './CriticReviewsBlock'
import { makeSummaryItem, makeTestWine } from '../test-fixtures'

const idle: EnrichmentAction = { busy: false, error: null, cachedAt: null, run: vi.fn() }
const summary = (...items: ReturnType<typeof makeSummaryItem>[]) => ({ ordered: items })

describe('CriticReviewsBlock — four explicit states (Phase 12.1 WI-4)', () => {
  it('Looking: skeleton lines and "Looking for critic scores…" while a lookup is running', () => {
    render(<CriticReviewsBlock wine={makeTestWine()} action={{ ...idle, busy: true }} />)
    expect(screen.getByText('Looking for critic scores…')).toBeInTheDocument()
  })

  it('Looking: a fresh scan whose lookup has not reported yet is Looking, not empty', () => {
    render(<CriticReviewsBlock wine={makeTestWine()} action={idle} lookupUnderWay />)
    expect(screen.getByText('Looking for critic scores…')).toBeInTheDocument()
    expect(screen.queryByText(/No critic scores found/)).not.toBeInTheDocument()
  })

  it('Nothing found: says so rather than disappearing', () => {
    render(<CriticReviewsBlock wine={makeTestWine({ review_data: [] })} action={idle} />)
    expect(screen.getByText('No critic scores found yet')).toBeInTheDocument()
    expect(screen.queryByText('Looking for critic scores…')).not.toBeInTheDocument()
  })

  it('Failed: names the failure and offers Try again, which re-runs', async () => {
    const run = vi.fn()
    render(<CriticReviewsBlock wine={makeTestWine()} action={{ ...idle, error: 'Review lookup failed', run }} />)
    expect(screen.getByText(/Review lookup failed —/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(run).toHaveBeenCalled()
  })

  it('Idle: a wine whose scores were never looked up says that, not that nothing was found', () => {
    render(<CriticReviewsBlock wine={makeTestWine()} action={idle} />)
    expect(screen.getByText(/haven’t been looked up yet/)).toBeInTheDocument()
    expect(screen.queryByText(/No critic scores found/)).not.toBeInTheDocument()
  })

  it('state precedence: scores win over everything; busy wins over nothing-found', () => {
    const withScores = makeTestWine({ critic_summary: summary(makeSummaryItem()) })
    expect(criticReviewsState(withScores, { ...idle, busy: true })).toBe('found')
    expect(criticReviewsState(makeTestWine({ review_data: [] }), { ...idle, busy: true })).toBe('looking')
  })
})

describe('CriticReviewsBlock — found (WI-10, D10)', () => {
  it('groups under "Your vintage (2019)" and "Other vintages", in the backend order', () => {
    const wine = makeTestWine({
      critic_summary: summary(
        makeSummaryItem({ publication: 'Burghound', score: 91 }),
        makeSummaryItem({ publication: 'Jeb Dunnuck', score: 95, trusted: false, tier: 2 }),
        makeSummaryItem({ publication: 'Wine Spectator', score: 92, vintage: 2017, same_vintage: false, tier: 3 }),
      ),
    })
    render(<CriticReviewsBlock wine={wine} action={idle} />)

    expect(screen.getByText('Your vintage (2019)')).toBeInTheDocument()
    expect(screen.getByText('Other vintages')).toBeInTheDocument()
    const order = screen.getAllByText(/^(Burghound|Jeb Dunnuck|Wine Spectator)$/).map((n) => n.textContent)
    expect(order).toEqual(['Burghound', 'Jeb Dunnuck', 'Wine Spectator'])
  })

  it('marks trusted sources, and tags a score from another vintage with its year', () => {
    const wine = makeTestWine({
      critic_summary: summary(
        makeSummaryItem({ publication: 'Vinous', score: 93, vintage: 2017, same_vintage: false, tier: 3 }),
        makeSummaryItem({ publication: 'Jeb Dunnuck', score: 95, trusted: false, tier: 2 }),
      ),
    })
    render(<CriticReviewsBlock wine={wine} action={idle} />)
    expect(screen.getAllByText('Trusted')).toHaveLength(1)
    expect(screen.getByText('2017')).toBeInTheDocument()
  })

  it('shows the citation attributes the source stated', () => {
    const wine = makeTestWine({
      critic_summary: summary(
        makeSummaryItem({ drinking_window: { start: 2028, end: 2045 }, vintage_character: 'very_good', deal: true }),
      ),
    })
    render(<CriticReviewsBlock wine={wine} action={idle} />)
    expect(screen.getByText('Drink 2028–2045')).toBeInTheDocument()
    expect(screen.getByText('Very good vintage')).toBeInTheDocument()
    expect(screen.getByText('Value pick')).toBeInTheDocument()
  })

  it('shows the first six, then "Show all (N)"', async () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeSummaryItem({ publication: `Critic ${i}`, score: 90 - i, trusted: false, tier: 2, known_publication: false })
    )
    render(<CriticReviewsBlock wine={makeTestWine({ critic_summary: summary(...items) })} action={idle} />)
    expect(screen.queryByText('Critic 7')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show all (8)' }))
    expect(screen.getByText('Critic 7')).toBeInTheDocument()
  })

  it('NV wines group under "This wine"', () => {
    const wine = makeTestWine({ vintage: null, critic_summary: summary(makeSummaryItem({ vintage: null })) })
    render(<CriticReviewsBlock wine={wine} action={idle} />)
    expect(screen.getByText('This wine')).toBeInTheDocument()
  })

  it('says when the scores were fetched for a different version of the wine', () => {
    const wine = makeTestWine({
      critic_summary: summary(makeSummaryItem()),
      enrichment_stale: { price: false, reviews: true },
    })
    render(<CriticReviewsBlock wine={wine} action={idle} />)
    expect(screen.getByText(/Fetched for a different version of this wine/)).toBeInTheDocument()
  })

  it('falls back to the shared ordering when an older backend sends no critic_summary', () => {
    const wine = makeTestWine({
      review_data: [{
        slug: 'a', name: 'A', product_url: 'https://a', fetched_at: '2026-10-01T00:00:00.000Z', source: 'configured',
        page_vintage: 2019, vintage_gap: 0, page_price: null,
        match: { producer: 'match', denomination: 'match', bottling: 'unknown', vintage: 'match', candidateVintage: 2019, vintageGap: 0 },
        critic_scores: [{ publication: 'Burghound', score: 91, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
      }],
    })
    render(<CriticReviewsBlock wine={wine} action={idle} />)
    expect(screen.getByText('Burghound')).toBeInTheDocument()
    expect(screen.getByText('Trusted')).toBeInTheDocument()
  })
})
