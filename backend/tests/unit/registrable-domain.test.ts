import { registrableDomain, sameRegistrableDomain } from '@shared/utils/registrable-domain'
import { extractVintage, scoreMatch } from '@shared/utils/wine-match'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { isNonProductUrl, isDenylistedDomain } from '@shared/config/denylisted-domains'
import { buildRetailerSearchUrl } from '@shared/utils/retailer-search-url'
import { aggregatePriceData } from '../../modules/price/aggregate'
import type { RetailerResult } from '../../modules/price/types'

describe('registrableDomain (Phase 12.2 WI-6)', () => {
  it.each([
    ['nyc.flatiron-wines.com', 'flatiron-wines.com'],
    ['sf.flatiron-wines.com', 'flatiron-wines.com'],
    ['www.klwines.com', 'klwines.com'],
    ['klwines.com', 'klwines.com'],
    ['shop.example.co.uk', 'example.co.uk'],
    ['https://sf.flatiron-wines.com/products/x', 'flatiron-wines.com'],
  ])('%s -> %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected)
  })

  it('treats both Flatiron storefronts as one shop, and other shops as different', () => {
    expect(sameRegistrableDomain('sf.flatiron-wines.com', 'nyc.flatiron-wines.com')).toBe(true)
    expect(sameRegistrableDomain('flatiron-wines.com', 'www.zachys.com')).toBe(false)
    expect(sameRegistrableDomain(null, 'zachys.com')).toBe(false)
  })
})

describe('Flatiron as a registrable domain', () => {
  const flatiron = RETAILER_CONFIG.find(r => r.slug === 'flatiron')!

  it('review discovery asks for site:flatiron-wines.com, which covers nyc. and sf.', () => {
    expect(flatiron.domain).toBe('flatiron-wines.com')
  })

  it('the link the user clicks stays on the NYC storefront', () => {
    expect(flatiron.storefrontHost).toBe('nyc.flatiron-wines.com')
    expect(buildRetailerSearchUrl(flatiron, 'colin')).toMatch(/^https:\/\/nyc\.flatiron-wines\.com\/search\?q=/)
  })

  it('the denylist and the non-product shapes cannot catch a product path on either host', () => {
    for (const host of ['nyc.flatiron-wines.com', 'sf.flatiron-wines.com']) {
      expect(isDenylistedDomain(host)).toBe(false)
      expect(isNonProductUrl(`https://${host}/products/joseph-colin-saint-aubin-1er-cru-en-remilly-2o24-750ml`)).toBe(false)
    }
    // The blog shape is still caught, on either host.
    expect(isNonProductUrl('https://nyc.flatiron-wines.com/blogs/news/x')).toBe(true)
  })

  it('a product page from the sf. storefront counts but cannot win nearest', () => {
    const base: RetailerResult = {
      slug: 'flatiron', name: 'Flatiron', price: 139.99, url: 'https://sf.flatiron-wines.com/products/x',
      is_preferred_retailer: true, distance_miles: 1, is_search_results_page: false, matched_vintage: 2024,
      vintage_mismatch: false, vintage_verdict: 'match', pack_quantity: 1, bottle_size_ml: null,
      non_standard_format: false, format_label: '', link_only: false, verification: 'verified', other_storefront: true,
    }
    const zachys: RetailerResult = { ...base, slug: 'zachys', name: 'Zachys', url: 'https://zachys.com/p', distance_miles: 20, other_storefront: false }
    const agg = aggregatePriceData([base, zachys])
    expect(agg.price_min).toBe(139.99)
    expect(agg.nearest_retailer?.slug).toBe('zachys')
    // Alone, it is still all there is.
    expect(aggregatePriceData([base]).nearest_retailer?.slug).toBe('flatiron')
  })
})

describe('tolerant vintage parse (Phase 12.2 WI-5)', () => {
  it('reads "2o24" in a slug as 2024', () => {
    expect(extractVintage('https://sf.flatiron-wines.com/products/joseph-colin-saint-aubin-1er-cru-en-remilly-2o24-750ml')).toBe(2024)
    expect(extractVintage('Colin 2O24')).toBe(2024)
  })

  it('prefers a strictly readable year', () => {
    expect(extractVintage('2019 colin 2o24')).toBe(2019)
  })

  it.each(['item 1o', 'room 2oo4', 'a 3o24 thing', 'sku 2ooo', '1o00 wines', 'x2o24x'])('does not invent a year from %s', text => {
    expect(extractVintage(text)).toBeNull()
  })

  it('a slug year that still cannot be read is unknown, never mismatch', () => {
    const v = scoreMatch(
      { title: 'Joseph Colin Saint-Aubin 1er Cru En Remilly', url: 'https://sf.flatiron-wines.com/products/joseph-colin-saint-aubin-en-remilly-2o2x' },
      { producer: 'Joseph Colin', denomination: 'Saint-Aubin', vintage: 2024, cuvee: null, vineyard: 'En Remilly', quality_classification: 'Premier Cru' }
    )
    expect(v.vintage).toBe('unknown')
  })

  it('the typoed slug now matches the wine vintage instead of reading unknown', () => {
    const v = scoreMatch(
      { title: 'Joseph Colin Saint-Aubin 1er Cru En Remilly', url: 'https://sf.flatiron-wines.com/products/joseph-colin-saint-aubin-1er-cru-en-remilly-2o24-750ml' },
      { producer: 'Joseph Colin', denomination: 'Saint-Aubin', vintage: 2024, cuvee: null, vineyard: 'En Remilly', quality_classification: 'Premier Cru' }
    )
    expect(v.candidateVintage).toBe(2024)
    expect(v.vintage).toBe('match')
  })
})
