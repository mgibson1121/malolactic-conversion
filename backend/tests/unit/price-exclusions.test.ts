import { describePriceExclusions } from '@shared/utils/price-exclusions'
import type { PriceData, RetailerPrice } from '@shared/types'

function retailer(over: Partial<RetailerPrice>): RetailerPrice {
  return {
    slug: 's', name: 'Shop', price: 50, url: 'https://x', distance_miles: 5, is_preferred_retailer: false,
    is_search_results_page: false, matched_vintage: 2019, vintage_mismatch: false, vintage_verdict: 'match',
    pack_quantity: 1, bottle_size_ml: null, non_standard_format: false, format_label: '', link_only: false,
    verification: 'unchecked', ...over,
  }
}
const data = (retailers: RetailerPrice[], avg: number | null = null): Pick<PriceData, 'price_avg' | 'retailers'> => ({
  price_avg: avg, retailers,
})

describe('describePriceExclusions (Phase 12.1 WI-4)', () => {
  it('names every reason with counts — the Marcoux case', () => {
    const r = describePriceExclusions(
      data([
        retailer({ vintage_mismatch: true, matched_vintage: 2020 }),
        retailer({ vintage_mismatch: true, matched_vintage: 2021 }),
        retailer({ non_standard_format: true, pack_quantity: 6 }),
        retailer({ non_standard_format: true, bottle_size_ml: 1500 }),
        retailer({ link_only: true, price: null }),
      ])
    )
    expect(r!.sentence).toBe(
      '5 listings found, none counted toward the average: 2 other vintages (2020, 2021), 1 six-pack, 1 magnum, 1 search-only.'
    )
    expect(r!.found).toBe(5)
  })

  it('is null when there is an average', () => {
    expect(describePriceExclusions(data([retailer({})], 50))).toBeNull()
  })

  it('is null when there are no listings at all (that case has its own message)', () => {
    expect(describePriceExclusions(data([]))).toBeNull()
    expect(describePriceExclusions(null)).toBeNull()
  })

  it('pluralises and singularises', () => {
    const r = describePriceExclusions(
      data([
        retailer({ non_standard_format: true, bottle_size_ml: 1500 }),
        retailer({ non_standard_format: true, bottle_size_ml: 1500 }),
        retailer({ non_standard_format: true, pack_quantity: 12 }),
      ])
    )
    expect(r!.sentence).toBe('3 listings found, none counted toward the average: 2 magnums, 1 12-bottle case.')
  })

  it('reports a single listing in the singular', () => {
    const r = describePriceExclusions(data([retailer({ price: null })]))
    expect(r!.sentence).toBe('1 listing found, none counted toward the average: 1 without a price.')
  })

  it('counts a listing once, under its first reason', () => {
    const r = describePriceExclusions(data([retailer({ link_only: true, vintage_mismatch: true, price: null })]))
    expect(r!.reasons).toEqual(['1 search-only'])
  })
})
