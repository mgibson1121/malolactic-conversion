import { fetchPriceData } from './index'
import type { WineEntry } from '@shared/types'

const baseWine: WineEntry = {
  id: 'wine-1',
  producer: 'Domaine Leroy',
  denomination: 'Gevrey-Chambertin',
  vintage: 2018,
  region: 'Burgundy',
  quality_classification: null,
  vineyard: null,
  cuvee: null,
  grape_varieties: ['Pinot Noir'],
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
}

describe('fetchPriceData', () => {
  const originalEnv = process.env.WINE_SEARCHER_API_KEY

  afterEach(() => {
    process.env.WINE_SEARCHER_API_KEY = originalEnv
    jest.restoreAllMocks()
  })

  it('returns null when WINE_SEARCHER_API_KEY is not set', async () => {
    delete process.env.WINE_SEARCHER_API_KEY
    const result = await fetchPriceData(baseWine)
    expect(result).toBeNull()
  })

  it('returns null when wine has no producer or denomination', async () => {
    process.env.WINE_SEARCHER_API_KEY = 'test-key'
    const emptyWine = { ...baseWine, producer: null, denomination: null }
    const result = await fetchPriceData(emptyWine)
    expect(result).toBeNull()
  })

  it('returns null and does not throw when API call fails', async () => {
    process.env.WINE_SEARCHER_API_KEY = 'test-key'
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'))
    const result = await fetchPriceData(baseWine)
    expect(result).toBeNull()
  })

  it('returns null when API returns non-OK status', async () => {
    process.env.WINE_SEARCHER_API_KEY = 'test-key'
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 })
    )
    const result = await fetchPriceData(baseWine)
    expect(result).toBeNull()
  })

  it('returns null when Wine-Searcher returns non-zero ReturnCode', async () => {
    process.env.WINE_SEARCHER_API_KEY = 'test-key'
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        Status: { ReturnCode: 1, StatusMessage: 'No matching wines found' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    const result = await fetchPriceData(baseWine)
    expect(result).toBeNull()
  })

  it('parses a successful API response correctly', async () => {
    process.env.WINE_SEARCHER_API_KEY = 'test-key'
    const mockResponse = {
      Status: { ReturnCode: 0, StatusMessage: 'Success' },
      Statistics: { 'price-min': 85, 'price-avg': 120, 'price-max': 200 },
      score: 92,
      'drink-from': '2025',
      'drink-to': '2035',
      Price: [
        {
          'merchant-name': 'K&L Wine Merchants',
          price: 85,
          link: 'https://klwines.com/product/1',
          state: 'CA',
          country: 'US',
          'physical-address': null,
        },
        {
          'merchant-name': 'Zachys',
          price: 110,
          link: 'https://zachys.com/product/1',
          state: 'NY',
          country: 'US',
          'physical-address': null,
        },
      ],
    }
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.min_price).toBe(85)
    expect(result!.avg_price).toBe(120)
    expect(result!.max_price).toBe(200)
    expect(result!.ws_score).toBe(92)
    expect(result!.drinking_window_start).toBe('2025')
    expect(result!.drinking_window_end).toBe('2035')
    expect(result!.retailers).toHaveLength(2)
    expect(result!.retailers[0].name).toBe('K&L Wine Merchants')
    expect(result!.retailers[0].price).toBe(85)
    expect(result!.retailers[0].location).toBe('CA, US')
    expect(result!.fetched_at).toBeTruthy()
  })

  it('sorts retailers by price ascending', async () => {
    process.env.WINE_SEARCHER_API_KEY = 'test-key'
    const mockResponse = {
      Status: { ReturnCode: 0, StatusMessage: 'Success' },
      Statistics: { 'price-min': 50, 'price-avg': 75, 'price-max': 100 },
      Price: [
        { 'merchant-name': 'Expensive', price: 100, link: null, state: null, country: null, 'physical-address': null },
        { 'merchant-name': 'Cheap', price: 50, link: null, state: null, country: null, 'physical-address': null },
        { 'merchant-name': 'Medium', price: 75, link: null, state: null, country: null, 'physical-address': null },
      ],
    }
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await fetchPriceData(baseWine)
    expect(result!.retailers.map(r => r.name)).toEqual(['Cheap', 'Medium', 'Expensive'])
  })
})
