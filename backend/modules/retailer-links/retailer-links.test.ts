import { getRetailerLinks } from './index'

describe('getRetailerLinks', () => {
  it('returns one link per configured retailer, all four slugs present', () => {
    const links = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: 2019 })
    expect(links.map((l) => l.slug).sort()).toEqual(['benchmark', 'kl', 'woodland', 'zachys'])
  })

  it('builds a query from producer + denomination + vintage, URL-encoded', () => {
    const links = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: 2019 })
    const kl = links.find((l) => l.slug === 'kl')!
    expect(kl.url).toBe('https://shop.klwines.com/products?searchText=Roumier%20Chambolle-Musigny%202019')
  })

  it('omits vintage from the query when null (NV wine)', () => {
    const links = getRetailerLinks({ producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: null })
    const kl = links.find((l) => l.slug === 'kl')!
    expect(kl.url).toBe('https://shop.klwines.com/products?searchText=Roumier%20Chambolle-Musigny')
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
