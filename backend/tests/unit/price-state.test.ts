/**
 * Phase 12.5 WI-1: one price state per wine, computed in the backend, one
 * line each — the same line on web and iOS because both render `line`.
 */
import type { PriceData, RetailerPrice } from '@shared/types'
import { isExactMatch, priceStateOf } from '@shared/utils/price-state'
import { priceWindowOf } from '@shared/utils/price-window'

const row = (slug: string, extra: Partial<RetailerPrice> = {}): RetailerPrice =>
  ({ slug, name: slug, price: 100, url: `https://example.com/${slug}`, is_preferred_retailer: false, matched_vintage: 2019, vintage_mismatch: false, vintage_verdict: 'match', link_only: false, is_search_results_page: true, ...extra }) as RetailerPrice
const data = (retailers: RetailerPrice[], extra: Partial<PriceData> = {}): PriceData =>
  ({ price_min: null, price_avg: null, price_max: null, other_vintage_price_range: null, nearest_retailer: null, fetched_at: '2026-11-01T00:00:00.000Z', retailers, ...extra }) as PriceData
const state = (d: PriceData, vintage = 2019) => priceStateOf(d, priceWindowOf(d, vintage))

describe('Price state (Phase 12.5 WI-1)', () => {
  it('never looked up → null (the clients own Checking… and Couldn’t check)', () => {
    expect(priceStateOf(null, null)).toBeNull()
  })

  it.each([
    ['priced', data([row('a', { price: 70 }), row('b', { price: 110 })], { price_min: 70, price_avg: 85, price_max: 110 }), '$85 avg'],
    ['estimated', data([row('a')], { price_min: 85, price_avg: 85, price_max: 85, headline_estimated: true }), '$85 avg · est.'],
    ['wide_range', data([row('a', { price: 75 }), row('b', { price: 245 })], { headline_basis: 'ambiguous' }), 'Prices vary widely'],
    ['similar_vintages', data([row('a', { matched_vintage: 2022, vintage_mismatch: true, vintage_verdict: 'mismatch' })]), 'Similar vintages'],
    ['no_average', data([row('a', { non_standard_format: true })]), 'Prices found, no average'],
    ['nothing_found', data([]), 'No prices found'],
  ] as const)('%s → "%s"', (kind, d, line) => {
    expect(state(d)).toMatchObject({ kind, line })
  })

  it('the range rides along with a priced line', () => {
    expect(state(data([row('a', { price: 70 }), row('b', { price: 110 })], { price_min: 70, price_avg: 85, price_max: 110 }))!.range).toEqual({ min: 70, max: 110 })
  })

  it('Gigondas (Saint-Damien 2019): a 2022 magnum (3 years — inside ±3) and a K&L search link → Similar vintages, the link not in the list', () => {
    const d = data([
      row('zachys', { price: 79.99, matched_vintage: 2022, vintage_mismatch: true, vintage_verdict: 'mismatch', non_standard_format: true, format_label: '1.5L' }),
      row('kl', { price: null, link_only: true, matched_vintage: null, vintage_verdict: 'unknown' }),
    ])
    const s = state(d)!
    expect(s.kind).toBe('similar_vintages')
    expect(s.priced).toEqual(['zachys'])
  })

  it('a search link alone, or listings only outside the window, is No prices found (WI-2)', () => {
    expect(state(data([row('kl', { price: null, link_only: true })]))!.kind).toBe('nothing_found')
    expect(state(data([row('old', { matched_vintage: 2010, vintage_mismatch: true })]))!.kind).toBe('nothing_found')
  })

  it('the priced rows follow the one display order (12.4 WI-3)', () => {
    const d = data([row('z', { name: 'Zed' }), row('a', { name: 'Astor', is_preferred_retailer: true })], { price_min: 100, price_avg: 100, price_max: 100 })
    expect(state(d)!.priced).toEqual(['a', 'z'])
  })
})

describe('Exact match (Phase 12.5 WI-4)', () => {
  it('only the exact wine and the exact vintage', () => {
    expect(isExactMatch(row('a', { bottling_difference: { extra: [], missing: [] } }))).toBe(true)
    expect(isExactMatch(row('a', { vintage_verdict: 'unknown', matched_vintage: null }))).toBe(false)
    expect(isExactMatch(row('a', { vintage_verdict: 'mismatch', vintage_mismatch: true }))).toBe(false)
    expect(isExactMatch(row('a', { bottling_difference: { extra: ['monvigliero'], missing: [] } }))).toBe(false)
    expect(isExactMatch(row('a', { bottling_difference: { extra: [], missing: [], colour: { stated: 'blanc', wine: 'red' } } }))).toBe(false)
    expect(isExactMatch(row('a', { outside_bottling: true }))).toBe(false)
  })

  it('the state lists the exact rows for their badges', () => {
    const d = data([row('a'), row('b', { vintage_verdict: 'unknown', matched_vintage: null })], { price_min: 100, price_avg: 100, price_max: 100 })
    expect(state(d)!.exact).toEqual(['a'])
  })
})
