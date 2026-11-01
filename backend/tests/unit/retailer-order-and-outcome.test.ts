import type { CriticSummary, PriceData, RetailerPrice, RetailerReview } from '@shared/types'
import { orderRetailers, priceWindowOf } from '@shared/utils/price-window'
import { priceOutcomeOf, reviewsOutcomeOf } from '@shared/utils/enrichment-outcome'

const row = (slug: string, name: string, preferred: boolean, extra: Partial<RetailerPrice> = {}): RetailerPrice =>
  ({ slug, name, price: 100, url: `https://example.com/${slug}`, is_preferred_retailer: preferred, matched_vintage: 2019, vintage_mismatch: false, ...extra }) as RetailerPrice

const data = (retailers: RetailerPrice[], extra: Partial<PriceData> = {}): PriceData =>
  ({ price_min: null, price_avg: null, price_max: null, other_vintage_price_range: null, nearest_retailer: null, fetched_at: '2026-11-01T00:00:00.000Z', retailers, ...extra }) as PriceData

describe('Retailer order (Phase 12.4 WI-3): nearest, preferred A–Z, others A–Z', () => {
  // The 2019 La Crau's shops, shuffled.
  const rows = [
    row('blockcellar', 'BlockCellar', false),
    row('kermitlynch', 'Kermit Lynch Wine Merchant', true),
    row('caskcartel', 'CaskCartel.com', false),
    row('benchmark', 'Benchmark Wine Group', true),
    row('astor', 'Astor Wines & Spirits', true),
    row('beerbarrel', 'beerbarrelco.com', false),
  ]

  it('puts the nearest first, then the configured shops A–Z, then the rest A–Z (case-insensitive)', () => {
    expect(orderRetailers(rows, 'benchmark').map(r => r.slug)).toEqual(['benchmark', 'astor', 'kermitlynch', 'beerbarrel', 'blockcellar', 'caskcartel'])
  })

  it('with no nearest, preferred A–Z still lead', () => {
    expect(orderRetailers(rows, null).map(r => r.slug).slice(0, 3)).toEqual(['astor', 'benchmark', 'kermitlynch'])
  })

  it('price_window.order holds only the rows within the window, in that order', () => {
    const d = data([...rows, row('old', 'Aaa Old Vintage', true, { matched_vintage: 2010, vintage_mismatch: true })], {
      nearest_retailer: rows[3] as never,
    })
    const window = priceWindowOf(d, 2019)!
    expect(window.hidden).toEqual(['old'])
    expect(window.order).toEqual(['benchmark', 'astor', 'kermitlynch', 'beerbarrel', 'blockcellar', 'caskcartel'])
  })
})

describe('Lookup outcome (Phase 12.4 WI-7)', () => {
  const none: CriticSummary = { ordered: [] }

  it('price: never looked up → null; searched, nothing → none_found; listings none countable → none_counted; counted → found', () => {
    expect(priceOutcomeOf(null, null)).toBeNull()
    expect(priceOutcomeOf(data([]), null)).toBe('none_found')
    const other = data([row('a', 'A', false, { matched_vintage: 2022, vintage_mismatch: true })])
    expect(priceOutcomeOf(other, priceWindowOf(other, 2019))).toBe('none_counted')
    expect(priceOutcomeOf(data([row('a', 'A', false)], { price_min: 100 }), null)).toBe('found')
    expect(priceOutcomeOf(data([row('a', 'A', false)], { headline_basis: 'ambiguous' }), null)).toBe('found')
  })

  it('price: listings that are all outside the window are nothing found, not a failure', () => {
    const far = data([row('a', 'A', false, { matched_vintage: 2008, vintage_mismatch: true })])
    expect(priceOutcomeOf(far, priceWindowOf(far, 2019))).toBe('none_found')
  })

  it('reviews: [] → none_found; pages without a displayed score → none_counted; a score → found; never failed', () => {
    expect(reviewsOutcomeOf(null, none)).toBeNull()
    expect(reviewsOutcomeOf([], none)).toBe('none_found')
    expect(reviewsOutcomeOf([{ slug: 'x' } as RetailerReview], none)).toBe('none_counted')
    expect(reviewsOutcomeOf([{ slug: 'x' } as RetailerReview], { ordered: [{ publication: 'Vinous' } as never] })).toBe('found')
  })
})
