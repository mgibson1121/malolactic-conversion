import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RetailerLinksSection } from './RetailerLinksSection'
import type { RetailerLink, WineEntry } from '@shared/types'
import * as api from '../api'

vi.mock('../api', () => ({
  fetchRetailerLinks: vi.fn(),
  updateWine: vi.fn(),
}))

const mockFetchRetailerLinks = api.fetchRetailerLinks as unknown as ReturnType<typeof vi.fn>
const mockUpdateWine = api.updateWine as unknown as ReturnType<typeof vi.fn>

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

beforeEach(() => {
  mockFetchRetailerLinks.mockReset()
  mockUpdateWine.mockReset()
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
