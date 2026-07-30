import { getRetailerLinks } from './index'

describe('getRetailerLinks', () => {
  it('returns one link per configured retailer, all eleven slugs present (updated 2026-07-29 — Phase 6.7\'s four plus three developer-nominated retailers)', () => {
    const links = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: 2019 })
    expect(links.map((l) => l.slug).sort()).toEqual([
      'acker',
      'benchmark',
      'crush',
      'flatiron',
      'kl',
      'morrell',
      'sokolin',
      'thatchers',
      'winelibrary',
      'woodland',
      'zachys',
    ])
  })

  it('builds a query from producer + denomination only, URL-encoded — no vintage token', () => {
    const links = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: 2019 })
    const kl = links.find((l) => l.slug === 'kl')!
    expect(kl.url).toBe('https://shop.klwines.com/products?searchText=Roumier%20Chambolle-Musigny')
  })

  it('drops the vintage even when known — a retailer search is broader than a single-SKU lookup (Phase 7.2)', () => {
    // Confirmed live 2026-07-26: Zachys's own search returns 0 results for
    // "Clos des Papes Châteauneuf-du-Pape 2020" but 4 for the same query
    // without the year — an added vintage risks a false "no results" even
    // when the retailer carries the wine under a different vintage.
    const withVintage = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: 2019 })
    const withoutVintage = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: null })
    expect(withVintage).toEqual(withoutVintage)
  })

  it('uses each retailer\'s own native search endpoint', () => {
    const links = getRetailerLinks({ producer: 'Leroy', denomination: 'Musigny', vintage: 2018 })
    const byslug = Object.fromEntries(links.map((l) => [l.slug, l.url]))
    expect(byslug.zachys).toMatch(/^https:\/\/www\.zachys\.com\/search\?q=/)
    expect(byslug.woodland).toMatch(/^https:\/\/whwc\.com\/search-results\/\?search_query=/)
    expect(byslug.benchmark).toMatch(/^https:\/\/www\.benchmarkwine\.com\/search\?q=/)
  })

  it('returns an empty array when producer and denomination are both missing', () => {
    expect(getRetailerLinks({ producer: null, denomination: null, vintage: 2019 })).toEqual([])
  })

  it('falls back to producer alone when denomination is missing', () => {
    const links = getRetailerLinks({ producer: 'Roumier', denomination: null, vintage: null })
    const kl = links.find((l) => l.slug === 'kl')!
    expect(kl.url).toBe('https://shop.klwines.com/products?searchText=Roumier')
  })
})
