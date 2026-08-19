import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { PriceData, RetailerPrice, WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { DiscoveryReview } from './DiscoveryReview'
import { fetchWinePrice, fetchWineReviews } from '../api'

vi.mock('../api', () => ({
  fetchWinePrice: vi.fn(),
  fetchWineReviews: vi.fn(),
  resolveRetailerUrl: vi.fn(),
}))
const mockFetchPrice = fetchWinePrice as unknown as ReturnType<typeof vi.fn>
const mockFetchReviews = fetchWineReviews as unknown as ReturnType<typeof vi.fn>

function makeWine(overrides: Partial<WineEntry> = {}): WineEntry {
  return {
    id: 'wine-1',
    producer: 'Domaine Leroy',
    denomination: 'Gevrey-Chambertin',
    vintage: 2019,
    region: 'Burgundy',
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    grape_varieties: null,
    label_image_url: null,
    tag_discovered: true,
    tag_wishlist: false,
    tag_cellar: false,
    tag_consumed: false,
    cellar_quantity: 0,
    cellar_category: null,
    drinking_window: null,
    vintage_rating: null,
    my_rating: null,
    my_tags: [],
    latest_tasting_note_id: null,
    wishlist_notes: null,
    price_paid: null,
    purchased_from: null,
    date_added: '2026-08-16T00:00:00.000Z',
    date_first_consumed: null,
    advice_linked: null,
    price_data: null,
    retailer_links: null,
    review_data: null,
    review_probe_log: null,
    ...overrides,
  } as unknown as WineEntry
}

function makeRetailer(overrides: Partial<RetailerPrice> = {}): RetailerPrice {
  return {
    slug: 'kl',
    name: 'K&L Wine Merchants',
    price: 120,
    url: 'https://shop.klwines.com/p/1',
    distance_miles: 3,
    is_preferred_retailer: true,
    is_search_results_page: false,
    matched_vintage: 2019,
    vintage_mismatch: false,
    vintage_verdict: 'match',
    pack_quantity: 1,
    bottle_size_ml: null,
    non_standard_format: false,
    format_label: '',
    link_only: false,
    verification: 'verified',
    ...overrides,
  }
}

function makePriceData(retailers: RetailerPrice[]): PriceData {
  return {
    price_min: 100,
    price_avg: 120,
    price_max: 140,
    other_vintage_price_range: null,
    retailers,
    nearest_retailer: retailers[0] ?? null,
    fetched_at: '2026-08-16T00:00:00.000Z',
  }
}

// Every test that mounts with a wine lacking price_data trips the
// auto-fetch-on-mount effect (unchanged Phase 6 behavior) — give it a
// harmless default so it resolves instead of throwing, and wait for it to
// settle before asserting, so state updates stay inside act().
beforeEach(() => {
  mockFetchPrice.mockResolvedValue(makeWine({ price_data: makePriceData([]) }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function renderAndSettle(wine: WineEntry, props: Partial<{
  onDone: () => void
  onTagUpdate: (id: string, tags: Record<string, unknown>) => void
  onWineUpdated: (wine: WineEntry) => void
  onPromote: (id: string, tags: Record<string, unknown>) => Promise<void>
  onDiscard: (id: string) => Promise<void>
}> = {}) {
  const result = render(
    <DiscoveryReview
      wine={wine}
      onDone={props.onDone ?? (() => {})}
      onTagUpdate={props.onTagUpdate ?? (() => {})}
      onWineUpdated={props.onWineUpdated ?? (() => {})}
      onPromote={props.onPromote}
      onDiscard={props.onDiscard}
    />
  )
  if (!wine.price_data) {
    await waitFor(() => expect(mockFetchPrice).toHaveBeenCalled())
  }
  return result
}

describe('DiscoveryReview — identity', () => {
  it('renders the wine identity header', async () => {
    await renderAndSettle(makeWine())
    expect(screen.getByText('Domaine Leroy · Gevrey-Chambertin')).toBeInTheDocument()
  })
})

describe('DiscoveryReview — reviews stay click-gated', () => {
  it('never calls fetchWineReviews on mount', async () => {
    await renderAndSettle(makeWine())
    expect(mockFetchReviews).not.toHaveBeenCalled()
  })

  it('calls fetchWineReviews only once the user clicks Fetch Reviews', async () => {
    mockFetchReviews.mockResolvedValue(makeWine({ review_data: [] }))
    await renderAndSettle(makeWine())

    await userEvent.click(screen.getByRole('button', { name: 'Fetch Reviews' }))

    expect(mockFetchReviews).toHaveBeenCalledWith('wine-1', undefined)
  })
})

describe('DiscoveryReview — price auto-fetch', () => {
  it('fetches price automatically on mount when the wine has none yet', async () => {
    await renderAndSettle(makeWine())
    expect(mockFetchPrice).toHaveBeenCalledWith('wine-1', undefined)
  })

  it('does not re-fetch price on mount when the wine already has it', async () => {
    await renderAndSettle(makeWine({ price_data: makePriceData([]) }))
    expect(mockFetchPrice).not.toHaveBeenCalled()
  })
})

describe('DiscoveryReview — preferred-retailer carry-check', () => {
  it('is not shown before price data resolves, and appears once it does', async () => {
    let resolvePrice!: (wine: WineEntry) => void
    mockFetchPrice.mockImplementation(
      () => new Promise<WineEntry>((resolve) => { resolvePrice = resolve })
    )
    render(<DiscoveryReview wine={makeWine()} onDone={() => {}} onTagUpdate={() => {}} onWineUpdated={() => {}} />)

    expect(screen.queryByText(/preferred retailer/i)).not.toBeInTheDocument()

    await act(async () => {
      resolvePrice(makeWine({ price_data: makePriceData([]) }))
    })

    expect(screen.getByText('Not yet seen at a preferred retailer')).toBeInTheDocument()
  })

  it('lists carrying preferred retailers once price data is present', async () => {
    const wine = makeWine({ price_data: makePriceData([makeRetailer({ name: 'K&L Wine Merchants' })]) })
    await renderAndSettle(wine)
    expect(
      screen.getByText(`Carried by K&L Wine Merchants — 1 of ${RETAILER_CONFIG.length} preferred retailers`)
    ).toBeInTheDocument()
  })

  it('says nothing was seen at a preferred retailer when none carried it', async () => {
    const wine = makeWine({
      price_data: makePriceData([makeRetailer({ is_preferred_retailer: false, name: 'Some Fallback Shop' })]),
    })
    await renderAndSettle(wine)
    expect(screen.getByText('Not yet seen at a preferred retailer')).toBeInTheDocument()
  })

  it('costs zero additional Serper calls — computed entirely from the existing price fetch', async () => {
    const wine = makeWine({ price_data: makePriceData([makeRetailer()]) })
    await renderAndSettle(wine)
    expect(mockFetchPrice).not.toHaveBeenCalled()
    expect(mockFetchReviews).not.toHaveBeenCalled()
  })
})

describe('DiscoveryReview — list decision', () => {
  it('offers Wishlist and Cellar toggles but not Discovered or Consumed', async () => {
    await renderAndSettle(makeWine({ price_data: makePriceData([]) }))
    expect(screen.getByRole('button', { name: '+ Wishlist' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Cellar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Discovered/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Consumed/ })).not.toBeInTheDocument()
  })

  it('calls onTagUpdate when a tag toggle is clicked', async () => {
    const onTagUpdate = vi.fn()
    await renderAndSettle(makeWine({ price_data: makePriceData([]) }), { onTagUpdate })

    await userEvent.click(screen.getByRole('button', { name: '+ Wishlist' }))

    expect(onTagUpdate).toHaveBeenCalledWith('wine-1', { tag_wishlist: true })
  })
})

describe('DiscoveryReview — done', () => {
  it('calls onDone when Done is clicked', async () => {
    const onDone = vi.fn()
    await renderAndSettle(makeWine({ price_data: makePriceData([]) }), { onDone })

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onDone).toHaveBeenCalled()
  })
})

// Phase 9.4 — draft mode (wine.promoted_at === null)
describe('DiscoveryReview — draft mode', () => {
  function draftWine(overrides: Partial<WineEntry> = {}): WineEntry {
    return makeWine({
      promoted_at: null,
      tag_discovered: false,
      tag_wishlist: false,
      tag_cellar: false,
      price_data: makePriceData([]),
      ...overrides,
    })
  }

  it('shows a neutral header instead of "Saved to Collection"', async () => {
    await renderAndSettle(draftWine())
    expect(screen.queryByText('✓ Saved to Collection')).not.toBeInTheDocument()
    expect(screen.getByText(/Not yet saved/)).toBeInTheDocument()
  })

  it('offers a three-way Discovered/Wishlist/Cellar tag choice', async () => {
    await renderAndSettle(draftWine())
    expect(screen.getByRole('button', { name: /Discovered/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Wishlist/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cellar/ })).toBeInTheDocument()
  })

  it('Save to Collection is disabled until a tag is selected', async () => {
    await renderAndSettle(draftWine())
    expect(screen.getByRole('button', { name: 'Save to Collection' })).toBeDisabled()
  })

  it('tag toggles update local state only — no onTagUpdate call for a draft', async () => {
    const onTagUpdate = vi.fn()
    await renderAndSettle(draftWine(), { onTagUpdate })

    await userEvent.click(screen.getByRole('button', { name: /Wishlist/ }))

    expect(onTagUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save to Collection' })).toBeEnabled()
  })

  it('Save to Collection calls onPromote with the selected tags', async () => {
    const onPromote = vi.fn().mockResolvedValue(undefined)
    await renderAndSettle(draftWine(), { onPromote })

    await userEvent.click(screen.getByRole('button', { name: /Cellar/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save to Collection' }))

    expect(onPromote).toHaveBeenCalledWith('wine-1', {
      tag_discovered: false,
      tag_wishlist: false,
      tag_cellar: true,
    })
  })

  it('Discard calls onDiscard', async () => {
    const onDiscard = vi.fn().mockResolvedValue(undefined)
    await renderAndSettle(draftWine(), { onDiscard })

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(onDiscard).toHaveBeenCalledWith('wine-1')
  })

  it('does not show Done for a draft', async () => {
    await renderAndSettle(draftWine())
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
  })
})

describe('DiscoveryReview — autoFireReviews (Phase 9.4, WI-6)', () => {
  it('fires the primary tier on mount when autoFireReviews is true and there is no review data yet', async () => {
    mockFetchReviews.mockResolvedValue(makeWine({ review_data: [] }))
    render(
      <DiscoveryReview
        wine={makeWine({ price_data: makePriceData([]), review_data: null })}
        autoFireReviews
        onDone={() => {}}
        onTagUpdate={() => {}}
        onWineUpdated={() => {}}
      />
    )

    await waitFor(() => expect(mockFetchReviews).toHaveBeenCalledWith('wine-1', { tier: 'primary' }))
  })

  it('does not fire reviews on mount when autoFireReviews is false (manual add / duplicate match)', async () => {
    await renderAndSettle(makeWine({ price_data: makePriceData([]) }))
    expect(mockFetchReviews).not.toHaveBeenCalled()
  })
})

describe('DiscoveryReview — reviews button copy (Phase 9.4, WI-6)', () => {
  it('shows "Search more retailers" once review_data exists with no critic scores', async () => {
    await renderAndSettle(makeWine({ price_data: makePriceData([]), review_data: [] }))
    expect(screen.getByRole('button', { name: 'Search more retailers' })).toBeInTheDocument()
  })

  it('shows "Refresh Reviews" once a critic score is present', async () => {
    const wine = makeWine({
      price_data: makePriceData([]),
      review_data: [
        {
          slug: 'kl',
          name: 'K&L Wine Merchants',
          product_url: 'https://shop.klwines.com/p/1',
          critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
          fetched_at: '2026-08-16T00:00:00.000Z',
          source: 'configured',
          page_vintage: 2019,
          vintage_gap: 0,
          match: { producer: 'match', denomination: 'match', bottling: 'unknown', vintage: 'match', candidateVintage: 2019, vintageGap: 0 },
          page_price: 120,
        },
      ],
    })
    await renderAndSettle(wine)
    expect(screen.getByRole('button', { name: 'Refresh Reviews' })).toBeInTheDocument()
  })

  it('shows "Fetch Reviews" when review_data has never been fetched', async () => {
    await renderAndSettle(makeWine({ price_data: makePriceData([]), review_data: null }))
    expect(screen.getByRole('button', { name: 'Fetch Reviews' })).toBeInTheDocument()
  })
})
