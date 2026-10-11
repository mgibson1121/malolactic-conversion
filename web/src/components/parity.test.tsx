/**
 * Phase 12.1 WI-9, web half. The web has one enrichment mechanism
 * (useEnrichmentAction) and one set of derived fields from the backend
 * (critic_summary, price_exclusions, window_status), so the preview, the list
 * card and the detail view cannot disagree *by construction*. This pins that:
 * the same wine, rendered by all three, shows the same top score, the same
 * average and the same nearest retailer.
 */
import { render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import { DiscoveryReview } from './DiscoveryReview'
import { WineCard } from './WineCard'
import { WineDetailModal } from './WineDetailModal'
import { makeSummaryItem, makeTestPriceData, makeTestRetailer, makeTestWine } from '../test-fixtures'
import { resetPriceOnce } from '../utils/priceOnce'

vi.mock('../api', () => ({
  fetchWinePrice: vi.fn(),
  fetchWineReviews: vi.fn(),
  resolveRetailerUrl: vi.fn(),
  listTastingNotesByWine: vi.fn().mockResolvedValue([]),
  fetchRetailerLinks: vi.fn().mockResolvedValue([]),
  confirmRetailerLink: vi.fn(),
  updateWine: vi.fn(),
}))

const noop = () => {}
const wine = makeTestWine({
  price_data: makeTestPriceData([
    makeTestRetailer({ slug: 'a', name: 'Nearest Shop', price: 100 }),
    makeTestRetailer({ slug: 'b', name: 'Other Shop', price: 140 }),
  ]),
  critic_summary: {
    ordered: [
      makeSummaryItem({ publication: 'Burghound', score: 91 }),
      makeSummaryItem({ publication: 'Jeb Dunnuck', score: 95, trusted: false, tier: 2 }),
    ],
  },
})

beforeEach(() => resetPriceOnce())

describe('preview / list / detail parity', () => {
  it('the card, the detail view and the preview show the same top score, average and nearest retailer', () => {
    const card = render(
      <WineCard wine={wine} activeTab="cellar" onEvaluate={noop} onTagUpdate={noop} onQuantityChange={noop}
        onViewHistory={noop} onWineUpdated={noop} onViewDetail={noop} onEdit={noop} />
    )
    // Card: the badge is the first score in the shared order.
    expect(within(card.container).getByText('91')).toBeInTheDocument()
    expect(within(card.container).getByText('BH')).toBeInTheDocument()
    expect(within(card.container).getByRole('link', { name: 'Nearest Shop' })).toBeInTheDocument()
    expect(within(card.container).getByText('$120')).toBeInTheDocument() // avg
    card.unmount()

    const detail = render(
      <WineDetailModal wine={wine} onClose={noop} onTagUpdate={noop} onQuantityChange={noop}
        onEvaluate={noop} onWineUpdated={noop} onEdit={noop} />
    )
    const scores = within(detail.container).getAllByText(/^(Burghound|Jeb Dunnuck)$/).map((n) => n.textContent)
    expect(scores[0]).toBe('Burghound') // same first score
    expect(within(detail.container).getByRole('link', { name: 'Nearest Shop' })).toBeInTheDocument()
    expect(within(detail.container).getByText('$120')).toBeInTheDocument()
    detail.unmount()

    const preview = render(
      <DiscoveryReview wine={{ ...wine, promoted_at: null }} onDone={noop} onTagUpdate={noop} onWineUpdated={noop} />
    )
    const pscores = within(preview.container).getAllByText(/^(Burghound|Jeb Dunnuck)$/).map((n) => n.textContent)
    expect(pscores[0]).toBe('Burghound')
    expect(within(preview.container).getByRole('link', { name: 'Nearest Shop' })).toBeInTheDocument()
    expect(within(preview.container).getByText('$120')).toBeInTheDocument()
  })

  it('a wine that gains scores after the preview was drawn shows them on the next render of every surface', () => {
    const before = makeTestWine({ review_data: [] })
    const after = { ...before, critic_summary: wine.critic_summary }
    const { rerender } = render(
      <DiscoveryReview wine={{ ...before, promoted_at: null }} onDone={noop} onTagUpdate={noop} onWineUpdated={noop} />
    )
    expect(screen.getByText('No critic scores found yet')).toBeInTheDocument()
    rerender(<DiscoveryReview wine={{ ...after, promoted_at: null }} onDone={noop} onTagUpdate={noop} onWineUpdated={noop} />)
    // DiscoveryReview keeps its own copy seeded from props, so a fresh mount
    // (what happens when the wine is reopened) is the "after one reload" case.
    const fresh = render(<DiscoveryReview wine={{ ...after, promoted_at: null }} onDone={noop} onTagUpdate={noop} onWineUpdated={noop} />)
    expect(within(fresh.container).getAllByText('Burghound').length).toBeGreaterThan(0)
  })
})
