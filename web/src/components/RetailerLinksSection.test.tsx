import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RetailerLinksSection } from './RetailerLinksSection'
import type { RetailerLink, WineEntry } from '@shared/types'
import * as api from '../api'
import { MATCHED_IDENTITY } from '../test-fixtures'

vi.mock('../api', () => ({
  fetchRetailerLinks: vi.fn(),
  updateWine: vi.fn(),
  confirmRetailerLink: vi.fn(),
}))

const mockFetchRetailerLinks = api.fetchRetailerLinks as unknown as ReturnType<typeof vi.fn>
const mockUpdateWine = api.updateWine as unknown as ReturnType<typeof vi.fn>
const mockConfirmRetailerLink = api.confirmRetailerLink as unknown as ReturnType<typeof vi.fn>

function makeWine(overrides: Partial<WineEntry> = {}): WineEntry {
  return {
    id: 'wine-1',
    producer: 'Roumier',
    vintage: 2019,
    region: 'Burgundy',
    denomination: 'Chambolle-Musigny',
    grape_varieties: ['Pinot Noir'],
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    wine_color: null,
    label_image_url: null,
    tag_discovered: true,
    tag_wishlist: false,
    tag_cellar: false,
    tag_consumed: false,
    cellar_quantity: 0,
    cellar_category: null,
    drinking_window: null,
    drinking_window_source: null,
    vintage_rating: null,
    vintage_rating_source: null,
    my_rating: null,
    my_tags: [],
    wishlist_notes: null,
    price_paid: null,
    purchased_from: null,
    latest_tasting_note_id: null,
    advice_linked: null,
    expert_reviews: null,
    community_sentiment: null,
    community_excerpts: null,
    price_data: null,
    retailer_links: null,
    date_added: '2024-01-01T00:00:00.000Z',
    promoted_at: '2024-01-01T00:00:00.000Z',
    date_first_consumed: null,
    ...overrides,
  }
}

const FIXTURE_LINKS: RetailerLink[] = [
  { slug: 'kl', name: 'K&L Wine Merchants', url: 'https://shop.klwines.com/products?searchText=Roumier' },
  { slug: 'zachys', name: 'Zachys', url: 'https://www.zachys.com/search?q=Roumier' },
  { slug: 'woodland', name: 'Woodland Hills Wine Co.', url: 'https://whwc.com/search-results/?search_query=Roumier' },
  { slug: 'benchmark', name: 'Benchmark Wine Group', url: 'https://www.benchmarkwine.com/search?q=Roumier' },
]

function mockClipboard(text: string | Error) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      readText: vi.fn().mockImplementation(() =>
        text instanceof Error ? Promise.reject(text) : Promise.resolve(text)
      ),
    },
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  mockFetchRetailerLinks.mockReset()
  mockUpdateWine.mockReset()
  mockConfirmRetailerLink.mockReset()
  mockClipboard(new Error('no clipboard in this test by default'))
})

describe('RetailerLinksSection', () => {
  it('renders collapsed by default without fetching links', () => {
    render(<RetailerLinksSection wine={makeWine()} onWineUpdated={() => {}} />)
    expect(screen.getByRole('button', { name: 'Search Retailers' })).toBeInTheDocument()
    expect(mockFetchRetailerLinks).not.toHaveBeenCalled()
  })

  it('fetches and displays a search link per retailer on expand', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    render(<RetailerLinksSection wine={makeWine()} onWineUpdated={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))

    await waitFor(() => expect(mockFetchRetailerLinks).toHaveBeenCalledWith('wine-1'))
    expect(await screen.findByText('K&L Wine Merchants')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Search' })).toHaveLength(4)
  })

  it('shows a Saved badge for retailers with an existing saved link', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    const wine = makeWine({ retailer_links: { kl: 'https://shop.klwines.com/products/details/1557135' } })
    render(<RetailerLinksSection wine={wine} onWineUpdated={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    expect(await screen.findByRole('link', { name: '✓ Saved' })).toHaveAttribute(
      'href',
      'https://shop.klwines.com/products/details/1557135'
    )
  })

  it('saving a link merges it into retailer_links and reports the updated wine', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    const wine = makeWine()
    const updatedWine = { ...wine, retailer_links: { kl: FIXTURE_LINKS[0].url } }
    mockUpdateWine.mockResolvedValue(updatedWine)
    const onWineUpdated = vi.fn()

    render(<RetailerLinksSection wine={wine} onWineUpdated={onWineUpdated} />)
    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    await screen.findByText('K&L Wine Merchants')

    const saveLinkButtons = screen.getAllByRole('button', { name: 'Save link' })
    await userEvent.click(saveLinkButtons[0])
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockUpdateWine).toHaveBeenCalledWith('wine-1', {
        retailer_links: { kl: FIXTURE_LINKS[0].url },
      })
    )
    expect(onWineUpdated).toHaveBeenCalledWith(updatedWine)
  })

  it('removing a saved link drops just that slug', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    const wine = makeWine({
      retailer_links: { kl: 'https://shop.klwines.com/products/details/1557135', zachys: 'https://www.zachys.com/products/xyz' },
    })
    const updatedWine = { ...wine, retailer_links: { zachys: 'https://www.zachys.com/products/xyz' } }
    mockUpdateWine.mockResolvedValue(updatedWine)
    const onWineUpdated = vi.fn()

    render(<RetailerLinksSection wine={wine} onWineUpdated={onWineUpdated} />)
    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    await screen.findByText('K&L Wine Merchants')

    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])

    await waitFor(() =>
      expect(mockUpdateWine).toHaveBeenCalledWith('wine-1', {
        retailer_links: { zachys: 'https://www.zachys.com/products/xyz' },
      })
    )
    expect(onWineUpdated).toHaveBeenCalledWith(updatedWine)
  })
})

describe('RetailerLinksSection — guided mode (Phase 7.2)', () => {
  it('does not show a confirmation prompt when guided is off (default)', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    mockClipboard('https://shop.klwines.com/products/details/1557135')
    render(<RetailerLinksSection wine={makeWine()} onWineUpdated={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    await screen.findByText('K&L Wine Merchants')
    await userEvent.click(screen.getAllByRole('link', { name: 'Search' })[0])

    expect(screen.queryByText(/Save & Extract/)).not.toBeInTheDocument()
  })

  it('prefills the confirmation field when the clipboard has a matching-domain URL', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    mockClipboard('https://shop.klwines.com/products/details/1557135')
    render(<RetailerLinksSection wine={makeWine()} onWineUpdated={() => {}} guided />)

    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    await screen.findByText('K&L Wine Merchants')
    await userEvent.click(screen.getAllByRole('link', { name: 'Search' })[0])

    expect(await screen.findByText(/Found a K&L Wine Merchants link on your clipboard/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save & Extract' })).toBeEnabled()
  })

  it('falls back to an empty manual-paste field when the clipboard URL does not match the retailer', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    mockClipboard('https://www.example.com/unrelated')
    render(<RetailerLinksSection wine={makeWine()} onWineUpdated={() => {}} guided />)

    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    await screen.findByText('K&L Wine Merchants')
    await userEvent.click(screen.getAllByRole('link', { name: 'Search' })[0])

    expect(await screen.findByText(/Paste the K&L Wine Merchants product page URL/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save & Extract' })).toBeDisabled()
  })

  it('falls back to manual paste when clipboard access is denied, without an error', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    mockClipboard(new Error('permission denied'))
    render(<RetailerLinksSection wine={makeWine()} onWineUpdated={() => {}} guided />)

    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    await screen.findByText('K&L Wine Merchants')
    await userEvent.click(screen.getAllByRole('link', { name: 'Search' })[0])

    expect(await screen.findByText(/Paste the K&L Wine Merchants product page URL/)).toBeInTheDocument()
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
  })

  it('saves and extracts from a confirmed link, then dismisses the prompt', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    mockClipboard('https://shop.klwines.com/products/details/1557135')
    const wine = makeWine()
    const updatedWine = { ...wine, retailer_links: { kl: 'https://shop.klwines.com/products/details/1557135' } }
    mockConfirmRetailerLink.mockResolvedValue(updatedWine)
    const onWineUpdated = vi.fn()

    render(<RetailerLinksSection wine={wine} onWineUpdated={onWineUpdated} guided />)
    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    await screen.findByText('K&L Wine Merchants')
    await userEvent.click(screen.getAllByRole('link', { name: 'Search' })[0])
    await screen.findByRole('button', { name: 'Save & Extract' })

    await userEvent.click(screen.getByRole('button', { name: 'Save & Extract' }))

    await waitFor(() =>
      expect(mockConfirmRetailerLink).toHaveBeenCalledWith(
        'wine-1',
        'kl',
        'https://shop.klwines.com/products/details/1557135'
      )
    )
    expect(onWineUpdated).toHaveBeenCalledWith(updatedWine)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save & Extract' })).not.toBeInTheDocument())
  })

  it('dismissing the confirmation prompt clears it without saving', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    mockClipboard('https://shop.klwines.com/products/details/1557135')
    render(<RetailerLinksSection wine={makeWine()} onWineUpdated={() => {}} guided />)

    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    await screen.findByText('K&L Wine Merchants')
    await userEvent.click(screen.getAllByRole('link', { name: 'Search' })[0])
    await screen.findByRole('button', { name: 'Save & Extract' })

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('button', { name: 'Save & Extract' })).not.toBeInTheDocument()
    expect(mockConfirmRetailerLink).not.toHaveBeenCalled()
  })

  it('shows a scores-found badge for a retailer automated review sourcing already succeeded on', async () => {
    mockFetchRetailerLinks.mockResolvedValue(FIXTURE_LINKS)
    const wine = makeWine({
      review_data: [
        {
          slug: 'kl',
          name: 'K&L Wine Merchants',
          product_url: 'https://shop.klwines.com/products/details/1557135',
          source: 'configured',
          ...MATCHED_IDENTITY,
          critic_scores: [{ publication: 'Wine Advocate', score: 95, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
          fetched_at: '2026-07-26T00:00:00.000Z',
        },
      ],
    })
    render(<RetailerLinksSection wine={wine} onWineUpdated={() => {}} guided />)

    await userEvent.click(screen.getByRole('button', { name: 'Search Retailers' }))
    await screen.findByText('K&L Wine Merchants')

    expect(screen.getByText('✓ 1 score found')).toBeInTheDocument()
  })
})
