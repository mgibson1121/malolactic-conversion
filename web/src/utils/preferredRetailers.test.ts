import type { PriceData, RetailerPrice } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { summarizePreferredRetailers } from './preferredRetailers'

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
    price_min: null,
    price_avg: null,
    price_max: null,
    other_vintage_price_range: null,
    retailers,
    nearest_retailer: null,
    fetched_at: '2026-08-16T00:00:00.000Z',
  }
}

describe('summarizePreferredRetailers', () => {
  it('returns an empty carried list and zero cost when priceData is null', () => {
    const result = summarizePreferredRetailers(null)
    expect(result.carried).toEqual([])
    expect(result.totalConfigured).toBe(RETAILER_CONFIG.length)
  })

  it('filters to only preferred retailers', () => {
    const preferred = makeRetailer({ slug: 'kl', is_preferred_retailer: true })
    const fallback = makeRetailer({ slug: 'random-shop', is_preferred_retailer: false })
    const result = summarizePreferredRetailers(makePriceData([preferred, fallback]))
    expect(result.carried).toEqual([preferred])
  })

  it('returns every preferred retailer that carries the wine, not just the first', () => {
    const a = makeRetailer({ slug: 'kl' })
    const b = makeRetailer({ slug: 'jjbuckley', is_preferred_retailer: true })
    const result = summarizePreferredRetailers(makePriceData([a, b]))
    expect(result.carried).toEqual([a, b])
  })

  it('totalConfigured always reflects RETAILER_CONFIG, regardless of what price_data found', () => {
    const result = summarizePreferredRetailers(makePriceData([]))
    expect(result.totalConfigured).toBe(RETAILER_CONFIG.length)
  })
})
