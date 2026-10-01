import { resolveOneRetailerUrl } from '../../routes/wines'
import { pageStatedFormat } from '../../modules/price/pack-format'

// The default product-page render is a real Puppeteer launch; no test here
// should open a browser.
jest.mock('../../modules/price/puppeteer-extract', () => ({ renderPageHtml: jest.fn().mockResolvedValue(null) }))
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

  // 2026-08-15 widening: the gate used to check the URL string for
  // "google.com/search", so it only ever matched fallback merchants. A
  // configured retailer's own on-site search box (K&L, whose price entry
  // has always been a constructed search URL with no resolve attempt) never
  // triggered resolution at all, regardless of intent.
  describe('a configured retailer (RETAILER_CONFIG has its domain)', () => {
    it('resolves an on-site search URL that is not shaped like google.com/search', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            organic: [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://shop.klwines.com/products/details/1954099' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      const retailer = makeRetailer({
        slug: 'kl',
        name: 'K&L Wine Merchants',
        url: 'https://shop.klwines.com/products?searchText=Domaine+Rousseau',
        link_only: true,
      })

      const resolved = await resolveOneRetailerUrl(WINE, retailer)

      expect(resolved.url).toBe('https://shop.klwines.com/products/details/1954099')
      expect(resolved.is_search_results_page).toBe(false)
      // A configured retailer has a known domain — it must get the
      // site:-restricted search (Step 1), not the open merchant-name query,
      // so K&L's bot-blocked render is never in the request path at all.
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(String(init.body)) as { q: string }
      expect(body.q).toContain('site:klwines.com')
    })

    it('still keeps link_only true — a resolved link is not the same claim as a verified price', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({ organic: [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://shop.klwines.com/products/details/1954099' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      const retailer = makeRetailer({ slug: 'kl', name: 'K&L Wine Merchants', link_only: true })

      const resolved = await resolveOneRetailerUrl(WINE, retailer)

      expect(resolved.link_only).toBe(true)
    })
  })

  it('leaves a real product page untouched regardless of its URL shape, since is_search_results_page is the only gate', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    const retailer = makeRetailer({
      url: 'https://www.kandlwines.example/products/details/123',
      is_search_results_page: false,
    })

    const resolved = await resolveOneRetailerUrl(WINE, retailer)

    expect(resolved).toEqual(retailer)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// 2026-10-01 — B-21's real page for La Rioja Alta 904 2015, trimmed. The
// Google Shopping title had no size; only the page's own heading does.
const B21_HTML = `<html><head><title>2015 La Rioja Alta Gran Reserva 904 | www.b-21.com</title></head>
<body><h1 class="name"> 2015 La Rioja Alta Gran Reserva 904 (1.5L)</h1>
<div class="selectwineclosed"> 750ml </div><div class="selectwineclosed"> 1.5L </div></body></html>`

describe('pageStatedFormat', () => {
  it('reads the size from the page heading', () => {
    expect(pageStatedFormat(B21_HTML)).toEqual({ pack_quantity: 1, bottle_size_ml: 1500 })
  })

  it('ignores sizes named only in the body — size pickers list every format', () => {
    const standard = B21_HTML.replace(' (1.5L)', '')
    expect(pageStatedFormat(standard)).toBeNull()
  })

  it('reads og:title too', () => {
    expect(pageStatedFormat('<meta property="og:title" content="Krug Grande Cuvée Magnum">')).toEqual({ pack_quantity: 1, bottle_size_ml: 1500 })
  })
})

describe('resolveOneRetailerUrl — format stated on the product page', () => {
  function serperFinds(link: string, title: string) {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ organic: [{ title, link }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
  }
  const RIOJA = { producer: 'La Rioja Alta, S.A.', denomination: 'Rioja', vintage: 2015, cuvee: '904', vineyard: null }
  const b21 = () => makeRetailer({ slug: 'b-21', name: 'B-21', price: 199.98, matched_vintage: 2015,
    url: 'https://www.google.com/search?q=B-21%20La%20Rioja%20Alta%20Rioja%20904' })

  it('flags a magnum the Shopping title did not mention', async () => {
    serperFinds('https://www.b-21.com/2015-La-Rioja-Alta-Gran-Reserva-904/productinfo/ESRATE15AG/', '2015 La Rioja Alta Gran Reserva 904 | www.b-21.com')
    const resolved = await resolveOneRetailerUrl(RIOJA, b21(), async () => B21_HTML)
    expect(resolved.url).toContain('b-21.com')
    expect(resolved).toMatchObject({ non_standard_format: true, bottle_size_ml: 1500, pack_quantity: 1, format_label: '1.5L' })
  })

  it('changes nothing when the page names no format, or cannot be rendered', async () => {
    serperFinds('https://www.b-21.com/p/1', '2015 La Rioja Alta Gran Reserva 904')
    const plain = await resolveOneRetailerUrl(RIOJA, b21(), async () => B21_HTML.replace(' (1.5L)', ''))
    expect(plain).toMatchObject({ non_standard_format: false, bottle_size_ml: null, format_label: '' })
    const failed = await resolveOneRetailerUrl(RIOJA, b21(), async () => null)
    expect(failed.non_standard_format).toBe(false)
  })

  it('never un-flags a listing already flagged from its Shopping title', async () => {
    serperFinds('https://www.b-21.com/p/1', '2015 La Rioja Alta Gran Reserva 904')
    const render = jest.fn(async () => '<h1>2015 La Rioja Alta Gran Reserva 904</h1>')
    const sixPack = { ...b21(), pack_quantity: 6, non_standard_format: true, format_label: '6-pack' }
    const resolved = await resolveOneRetailerUrl(RIOJA, sixPack, render)
    expect(resolved).toMatchObject({ pack_quantity: 6, non_standard_format: true, format_label: '6-pack' })
    expect(render).not.toHaveBeenCalled()
  })
})
