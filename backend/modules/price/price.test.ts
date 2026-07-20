import { fetchPriceData } from './index'
import type { WineEntry } from '@shared/types'

// ─── Puppeteer mock ──────────────────────────────────────────────────────────
jest.mock('./puppeteer-extract', () => ({
  renderPageHtml: jest.fn(),
}))
import { renderPageHtml } from './puppeteer-extract'
const mockRenderPageHtml = renderPageHtml as jest.MockedFunction<typeof renderPageHtml>

// ─── Serper fetch mock ────────────────────────────────────────────────────────
let mockSerperItems: Array<{ title: string; source: string; link: string; price?: string }> = []

const originalFetch = global.fetch
beforeEach(() => {
  jest.spyOn(global, 'fetch').mockImplementation((url, init) => {
    if (String(url).includes('google.serper.dev')) {
      return Promise.resolve(
        new Response(JSON.stringify({ shopping: mockSerperItems }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    }
    return Promise.reject(new Error('unexpected fetch: ' + url))
  })
})

afterEach(() => {
  global.fetch = originalFetch
  jest.clearAllMocks()
  mockSerperItems = []
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const KL_URL = 'https://www.klwines.com/p/i?i=1234567'
const ZACHYS_URL = 'https://www.zachys.com/products/leroy-gevrey-2018'
const WOODLAND_URL = 'https://www.whwc.com/products/leroy'
const BENCHMARK_URL = 'https://www.benchmarkwine.com/products/leroy'
const OTHER_URL = 'https://www.someotherwinestore.com/products/leroy'
const OTHER_URL_2 = 'https://www.anotherwineshop.com/products/leroy'

const RENDERED_HTML = '<html><body><span class="price">$249.00</span><p>12 results</p></body></html>'
const NO_RESULTS_HTML = '<html><body><p>0 Results</p><p>No results.</p></body></html>'

function makeItem(source: string, link: string, price?: string) {
  return { title: 'Domaine Leroy Gevrey-Chambertin 2018', source, link, price }
}

const baseWine: WineEntry = {
  id: 'wine-1',
  producer: 'Domaine Leroy',
  denomination: 'Gevrey-Chambertin',
  vintage: 2018,
  region: 'Burgundy',
  quality_classification: null,
  vineyard: null,
  cuvee: null,
  grape_varieties: ['Pinot Noir'],
  label_image_url: null,
  tag_discovered: true,
  tag_wishlist: false,
  tag_cellar: false,
  tag_consumed: false,
  cellar_quantity: 0,
  cellar_category: null,
  drinking_window: null,
  vintage_rating: null,
  my_rating: null,
  my_tags: [],
  wishlist_notes: null,
  price_paid: null,
  purchased_from: null,
  latest_tasting_note_id: null,
  advice_linked: null,
  expert_reviews: null,
  community_sentiment: null,
  community_excerpts: null,
  price_data: null,
  retailer_links: null,
  date_added: '2024-01-01T00:00:00.000Z',
  date_first_consumed: null,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('fetchPriceData', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.SERPER_API_KEY = 'test-serper-key'
    mockRenderPageHtml.mockResolvedValue(RENDERED_HTML)
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.SERPER_API_KEY
  })

  it('returns null when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY
    expect(await fetchPriceData(baseWine)).toBeNull()
  })

  it('returns null when SERPER_API_KEY is not set', async () => {
    delete process.env.SERPER_API_KEY
    expect(await fetchPriceData(baseWine)).toBeNull()
  })

  it('returns null when wine has no producer or denomination', async () => {
    expect(await fetchPriceData({ ...baseWine, producer: null, denomination: null })).toBeNull()
  })

  it('returns an empty (not null) PriceData when Serper returns no results', async () => {
    // Distinguishes "we tried and found nothing" from "never fetched" so the
    // UI can show an explicit "no matching listings found" state instead of
    // either silence or an incorrect price.
    mockSerperItems = []
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers).toHaveLength(0)
    expect(result!.price_min).toBeNull()
    expect(result!.price_avg).toBeNull()
    expect(result!.price_max).toBeNull()
    expect(result!.nearest_retailer).toBeNull()
    expect(result!.fetched_at).toBeTruthy()
  })

  it('returns an empty PriceData (not a wrong price) when no Serper result is actually relevant to the wine', async () => {
    // A completely unrelated product must never be surfaced as this wine's price.
    mockSerperItems = [makeItem('Some Other Store', OTHER_URL, '$45.00')]
    mockSerperItems[0].title = 'Riedel Wine Glass Set of 6'
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers).toHaveLength(0)
    expect(result!.price_min).toBeNull()
  })

  it('flags vintage_mismatch when the matched listing is a different year than the wine', async () => {
    mockSerperItems = [{
      title: 'Domaine Leroy Gevrey-Chambertin 2015',
      source: 'Some Other Store',
      link: OTHER_URL,
      price: '$300.00',
    }]
    const result = await fetchPriceData(baseWine) // baseWine.vintage === 2018
    const other = result!.retailers.find(r => r.slug === 'some-other-store')
    expect(other?.matched_vintage).toBe(2015)
    expect(other?.vintage_mismatch).toBe(true)
  })

  it('does not flag vintage_mismatch when the matched listing is the same year as the wine', async () => {
    mockSerperItems = [makeItem('Some Other Store', OTHER_URL, '$300.00')] // title includes "2018"
    const result = await fetchPriceData(baseWine)
    const other = result!.retailers.find(r => r.slug === 'some-other-store')
    expect(other?.matched_vintage).toBe(2018)
    expect(other?.vintage_mismatch).toBe(false)
  })

  it('excludes confirmed vintage-mismatched retailers from price stats and nearest-retailer selection', async () => {
    // A listing that's definitely a different vintage is not "this wine at
    // that price" — it must stay visible in the retailer list (badged) but
    // must not drag price_min/avg/max or "nearest" toward a wrong-vintage
    // number. Previously these were blended in indistinguishably from a
    // confirmed match.
    mockSerperItems = [
      { title: 'Domaine Leroy Gevrey-Chambertin 2015', source: 'K&L Wine Merchants', link: KL_URL, price: '$50.00' },
      { title: 'Domaine Leroy Gevrey-Chambertin 2018', source: 'Benchmark Wine Group', link: BENCHMARK_URL, price: '$300.00' },
    ]
    const result = await fetchPriceData(baseWine) // baseWine.vintage === 2018
    expect(result!.retailers).toHaveLength(2) // both still shown
    expect(result!.price_min).toBe(300)
    expect(result!.price_max).toBe(300)
    expect(result!.price_avg).toBe(300)
    expect(result!.nearest_retailer?.slug).toBe('benchmark')
  })

  it('filters Serper results to preferred retailer domains (Pass 1)', async () => {
    mockSerperItems = [
      makeItem('K&L Wine Merchants', KL_URL, '$249.00'),
      makeItem('Some Other Store', OTHER_URL, '$200.00'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers).toHaveLength(1)
    expect(result!.retailers[0].slug).toBe('kl')
    expect(result!.retailers[0].is_preferred_retailer).toBe(true)
  })

  it('matches a preferred retailer despite formatting drift in Serper\'s source string (Pass 1)', async () => {
    // Regression guard: Serper's `source` field for the same merchant has been
    // observed as "K&L Wine Merchants", "K & L Wine Merchants" (spaced
    // ampersand), and "KLWines.com" (no ampersand at all). A literal
    // `.includes('k&l')` check only matches the first form — the other two
    // silently fell through to the Pass 2 fallback, which uses Serper's raw
    // google.com/search?ibp=oshop aggregator link instead of the constructed
    // klwines.com search URL. That surfaced as the K&L link pointing to an
    // empty Google Shopping details page.
    for (const source of ['K & L Wine Merchants', 'KLWines.com']) {
      mockSerperItems = [makeItem(source, KL_URL, '$249.00')]
      const result = await fetchPriceData(baseWine)
      expect(result!.retailers).toHaveLength(1)
      expect(result!.retailers[0].slug).toBe('kl')
      expect(result!.retailers[0].is_preferred_retailer).toBe(true)
      expect(result!.retailers[0].url).toContain('shop.klwines.com')
    }
  })

  it('falls back to any retailer results when no preferred retailers match (Pass 2)', async () => {
    mockSerperItems = [
      makeItem('Some Other Store', OTHER_URL, '$200.00'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers[0].is_preferred_retailer).toBe(false)
  })

  it('computes price_min/avg/max from Serper prices', async () => {
    mockSerperItems = [
      makeItem('K&L Wine Merchants', KL_URL, '$100.00'),
      makeItem('Zachys', ZACHYS_URL, '$120.00'),
      makeItem('Woodland Hills Wine Co.', WOODLAND_URL, '$110.00'),
      makeItem('Benchmark Wine Group', BENCHMARK_URL, '$130.00'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result!.price_min).toBe(100)
    expect(result!.price_max).toBe(130)
    expect(result!.price_avg).toBe(115)
  })

  it('drops a preferred retailer whose live search page reports no results', async () => {
    // Root-cause fix for the Domaine Rousseau / K&L case: Serper's shopping
    // data can attribute a price to a retailer whose own live search no
    // longer surfaces the wine (delisted, sold out, stale snapshot). K&L's
    // constructed search URL is rendered and checked before its price is
    // trusted — if the live page says there are no results, the retailer is
    // dropped entirely rather than shown with a price nothing backs up.
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(NO_RESULTS_HTML)
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(0)
    expect(result!.price_min).toBeNull()
  })

  it('drops a fallback retailer whose live search page reports no results', async () => {
    mockSerperItems = [makeItem('Some Other Store', OTHER_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(NO_RESULTS_HTML)
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(0)
  })

  it('keeps a retailer\'s Serper price when the live-page render fails', async () => {
    // A Puppeteer timeout or network hiccup isn't evidence the retailer has
    // delisted the wine — only an explicit "no results" signal on a page
    // that did render should drop a retailer.
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(null)
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(1)
    expect(result!.retailers[0].price).toBe(199)
  })

  it('keeps a retailer when its live search page does show results', async () => {
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(RENDERED_HTML)
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(1)
    expect(result!.retailers[0].price).toBe(199)
  })

  it('identifies nearest preferred retailer to NYC by Haversine distance', async () => {
    mockSerperItems = [
      makeItem('K&L Wine Merchants', KL_URL, '$200.00'),
      makeItem('Benchmark Wine Group', BENCHMARK_URL, '$200.00'),
    ]
    const result = await fetchPriceData(baseWine)
    // K&L NYC store is closer to NYC than Benchmark (Napa)
    expect(result!.nearest_retailer?.slug).toBe('kl')
  })

  it('includes multiple fallback retailers with independent search URLs and slugs', async () => {
    mockSerperItems = [
      makeItem('Some Other Store', OTHER_URL, '$200.00'),
      makeItem('Another Wine Shop', OTHER_URL_2, '$210.00'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(2)
    const first = result!.retailers.find(r => r.slug === 'some-other-store')
    const second = result!.retailers.find(r => r.slug === 'another-wine-shop')
    expect(first?.price).toBe(200)
    expect(second?.price).toBe(210)
    expect(first?.url).not.toBe(second?.url)
  })

  it('includes fetched_at ISO timestamp', async () => {
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$249.00')]
    const result = await fetchPriceData(baseWine)
    expect(result!.fetched_at).toBeTruthy()
    expect(new Date(result!.fetched_at).getTime()).not.toBeNaN()
  })

  it('uses a constructed retailer search URL instead of the raw Serper link for preferred retailers', async () => {
    // Serper's shopping `link` often points to a Google Shopping aggregator
    // page rather than the retailer's real product page. Preferred-retailer
    // results should use the verified retailer search URL instead.
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$249.00')]
    const result = await fetchPriceData(baseWine)
    const kl = result!.retailers.find(r => r.slug === 'kl')
    expect(kl?.url).toBe('https://shop.klwines.com/products?searchText=Domaine%20Leroy%20Gevrey-Chambertin%202018')
    expect(kl?.url).not.toBe(KL_URL)
  })

  it('builds the correct search URL for each preferred retailer', async () => {
    mockSerperItems = [
      makeItem('K&L Wine Merchants', KL_URL, '$100.00'),
      makeItem('Zachys', ZACHYS_URL, '$100.00'),
      makeItem('Woodland Hills Wine Co.', WOODLAND_URL, '$100.00'),
      makeItem('Benchmark Wine Group', BENCHMARK_URL, '$100.00'),
    ]
    const result = await fetchPriceData(baseWine)
    const bySlug = Object.fromEntries(result!.retailers.map(r => [r.slug, r.url]))
    expect(bySlug.kl).toContain('shop.klwines.com/products?searchText=')
    expect(bySlug.zachys).toContain('zachys.com/search?q=')
    expect(bySlug.woodland).toContain('whwc.com/search-results/?search_query=')
    expect(bySlug.benchmark).toContain('benchmarkwine.com/search?q=')
  })

  it('never uses Serper\'s raw aggregator link as the outbound URL for fallback retailers', async () => {
    // Root-cause regression guard: Serper's `link` field is always a
    // google.com/search?ibp=oshop Shopping *product* deep link, for every
    // merchant, with no exception — it frequently 404s or shows "Details
    // aren't available for this product." That's a structural property of
    // Serper's response, not a per-retailer quirk, so whichever fallback
    // retailer gets pulled in next hits the exact same broken link unless
    // the fix is generic. buildFallbackUrl must never leak item.link through.
    mockSerperItems = [makeItem('Some Other Store', OTHER_URL, '$200.00')]
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers[0].url).not.toBe(OTHER_URL)
    expect(result!.retailers[0].url).not.toContain('ibp=oshop')
    expect(result!.retailers[0].url).toContain('google.com/search?q=')
  })
})
