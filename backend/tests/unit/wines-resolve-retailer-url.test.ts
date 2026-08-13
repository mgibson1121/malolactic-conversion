import { resolveOneRetailerUrl } from '../../routes/wines'
import type { RetailerPrice } from '@shared/types'

const originalFetch = global.fetch
const originalEnv = process.env

const WINE = {
  producer: 'Domaine Rousseau',
  denomination: 'Gevrey-Chambertin',
  vintage: 2019,
  cuvee: null,
  vineyard: null,
}

function makeRetailer(overrides: Partial<RetailerPrice> = {}): RetailerPrice {
  return {
    slug: 'central-wine-merchants',
    name: 'Central Wine Merchants',
    price: 120,
    url: 'https://www.google.com/search?q=Central%20Wine%20Merchants%20Domaine%20Rousseau',
    distance_miles: 0,
    is_preferred_retailer: false,
    is_search_results_page: true,
    matched_vintage: 2019,
    vintage_mismatch: false,
    vintage_verdict: 'match',
    pack_quantity: 1,
    bottle_size_ml: null,
    non_standard_format: false,
    format_label: '',
    link_only: false,
    verification: 'unchecked',
    ...overrides,
  }
}

beforeEach(() => {
  process.env = { ...originalEnv, SERPER_API_KEY: 'test-serper-key' }
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = originalEnv
  jest.restoreAllMocks()
})

describe('resolveOneRetailerUrl', () => {
  it('replaces a Google search URL with the real product page it finds', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          organic: [
            { title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.centralwinemerchants.com/p/1' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const resolved = await resolveOneRetailerUrl(WINE, makeRetailer())

    expect(resolved.url).toBe('https://www.centralwinemerchants.com/p/1')
    expect(resolved.is_search_results_page).toBe(false)
  })

  it('keeps the existing Google search link, unmodified, when nothing is found', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ organic: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    const retailer = makeRetailer()

    const resolved = await resolveOneRetailerUrl(WINE, retailer)

    expect(resolved).toEqual(retailer)
  })

  // "Once per shop per wine forever" — a retailer already pointing at a real
  // product page must never spend a Serper call to be told the same thing.
  it('spends nothing on a retailer that is already resolved', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    const retailer = makeRetailer({
      url: 'https://www.centralwinemerchants.com/p/1',
      is_search_results_page: false,
    })

    const resolved = await resolveOneRetailerUrl(WINE, retailer)

    expect(resolved).toEqual(retailer)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('degrades gracefully with no Serper key rather than throwing', async () => {
    delete process.env.SERPER_API_KEY
    const fetchSpy = jest.spyOn(global, 'fetch')
    const retailer = makeRetailer()

    const resolved = await resolveOneRetailerUrl(WINE, retailer)

    expect(resolved).toEqual(retailer)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
