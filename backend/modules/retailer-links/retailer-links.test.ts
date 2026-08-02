import { getRetailerLinks } from './index'

describe('getRetailerLinks', () => {
  it('returns one link per configured retailer, all twelve slugs present (updated 2026-08-02 — JJ Buckley added to close a user-reported coverage gap)', () => {
    const links = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: 2019, cuvee: null, vineyard: null })
    expect(links.map((l) => l.slug).sort()).toEqual([
      'acker',
      'benchmark',
      'crush',
      'flatiron',
      'jjbuckley',
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
    const links = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: 2019, cuvee: null, vineyard: null })
    const kl = links.find((l) => l.slug === 'kl')!
    expect(kl.url).toBe('https://shop.klwines.com/products?searchText=Roumier%20Chambolle-Musigny')
  })

  it('includes cuvee and vineyard in the query when present (2026-07-30 fix)', () => {
    // Denomination alone is too generic for cuvee/vineyard-driven wines —
    // "Drappier Champagne" or "Louis Latour Pommard" covers every product a
    // producer sells at that denomination, not the specific bottling.
    const withCuvee = getRetailerLinks({ producer: 'Drappier', denomination: 'Champagne', vintage: 2012, cuvee: 'Grande Sendrée', vineyard: null })
    const kl = withCuvee.find((l) => l.slug === 'kl')!
    expect(kl.url).toBe('https://shop.klwines.com/products?searchText=Drappier%20Champagne%20Grande%20Sendr%C3%A9e')

    const withVineyard = getRetailerLinks({ producer: 'Louis Latour', denomination: 'Pommard', vintage: 2017, cuvee: null, vineyard: 'Les Épenots' })
    const klVineyard = withVineyard.find((l) => l.slug === 'kl')!
    expect(klVineyard.url).toBe('https://shop.klwines.com/products?searchText=Louis%20Latour%20Pommard%20Les%20%C3%89penots')
  })

  it('drops the vintage even when known — a retailer search is broader than a single-SKU lookup (Phase 7.2)', () => {
    // Confirmed live 2026-07-26: Zachys's own search returns 0 results for
    // "Clos des Papes Châteauneuf-du-Pape 2020" but 4 for the same query
    // without the year — an added vintage risks a false "no results" even
    // when the retailer carries the wine under a different vintage.
    const withVintage = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: 2019, cuvee: null, vineyard: null })
    const withoutVintage = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: null, cuvee: null, vineyard: null })
    expect(withVintage).toEqual(withoutVintage)
  })

  it('uses each retailer\'s own native search endpoint', () => {
    const links = getRetailerLinks({ producer: 'Leroy', denomination: 'Musigny', vintage: 2018, cuvee: null, vineyard: null })
    const byslug = Object.fromEntries(links.map((l) => [l.slug, l.url]))
    expect(byslug.zachys).toMatch(/^https:\/\/www\.zachys\.com\/search\?q=/)
    expect(byslug.woodland).toMatch(/^https:\/\/whwc\.com\/search-results\/\?search_query=/)
    expect(byslug.benchmark).toMatch(/^https:\/\/www\.benchmarkwine\.com\/search\?q=/)
  })

  // ─── Phase 7.3 retailer search-URL patterns, verified live 2026-07-30 ─────
  // A report of dead "View" links (Wine Library specifically) surfaced that
  // the seven retailers added 2026-07-29 were still on an unverified generic
  // guess. Live-checked all seven: Crush, Flatiron, and Thatcher's (Shopify)
  // genuinely work via the generic guess; Sokolin, Acker, and Wine Library
  // did not and now have explicit cases; Morrell has no navigable search URL
  // at all and falls back to a Google site-search.

  it('uses the correct search endpoint for the three retailers fixed 2026-07-30', () => {
    const links = getRetailerLinks({ producer: 'Leroy', denomination: 'Musigny', vintage: 2018, cuvee: null, vineyard: null })
    const byslug = Object.fromEntries(links.map((l) => [l.slug, l.url]))
    expect(byslug.sokolin).toMatch(/^https:\/\/www\.sokolin\.com\/catalogsearch\/result\/\?q=/)
    expect(byslug.acker).toMatch(/^https:\/\/www\.ackerwines\.com\/shop\/\?fwp_search_for_shop=/)
    expect(byslug.winelibrary).toMatch(/^https:\/\/winelibrary\.com\/search\?search=/)
  })

  it('falls back to a Google site-search for Morrell, which has no navigable on-site search URL', () => {
    const links = getRetailerLinks({ producer: 'Leroy', denomination: 'Musigny', vintage: 2018, cuvee: null, vineyard: null })
    const morrell = links.find((l) => l.slug === 'morrell')!
    expect(morrell.url).toMatch(/^https:\/\/www\.google\.com\/search\?q=/)
    expect(morrell.url).toContain(encodeURIComponent('site:morrellwine.com'))
  })

  it('confirms the generic default guess for Crush, Flatiron, and Thatcher\'s (verified live, unchanged)', () => {
    const links = getRetailerLinks({ producer: 'Leroy', denomination: 'Musigny', vintage: 2018, cuvee: null, vineyard: null })
    const byslug = Object.fromEntries(links.map((l) => [l.slug, l.url]))
    expect(byslug.crush).toMatch(/^https:\/\/crushwineco\.com\/search\?q=/)
    expect(byslug.flatiron).toMatch(/^https:\/\/nyc\.flatiron-wines\.com\/search\?q=/)
    expect(byslug.thatchers).toMatch(/^https:\/\/thatcherswine\.com\/search\?q=/)
  })

  it('returns an empty array when producer and denomination are both missing', () => {
    expect(getRetailerLinks({ producer: null, denomination: null, vintage: 2019, cuvee: null, vineyard: null })).toEqual([])
  })

  it('falls back to producer alone when denomination is missing', () => {
    const links = getRetailerLinks({ producer: 'Roumier', denomination: null, vintage: null, cuvee: null, vineyard: null })
    const kl = links.find((l) => l.slug === 'kl')!
    expect(kl.url).toBe('https://shop.klwines.com/products?searchText=Roumier')
  })
})
