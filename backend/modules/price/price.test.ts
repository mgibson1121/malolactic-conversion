import { fetchPriceData, aggregatePriceData } from './index'
import type { WineEntry } from '@shared/types'
import type { RetailerResult } from './types'

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

// K&L is deliberately excluded from Serper-sourced matching (see index.ts's
// buildKlLinkOnlyResult and serper-query.ts's nonKlItems filtering) — its own
// site blocks Puppeteer behind a bot-detection challenge, so nothing about
// its price can be verified. KL_URL stands in for the raw Serper-provided
// link, used only to prove it never leaks through as K&L's outbound URL.
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
  drinking_window_source: null,
  vintage_rating: null,
  vintage_rating_source: null,
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

  it('contains only the always-present K&L link-only entry when Serper returns no results', async () => {
    // K&L's link-only entry (see buildKlLinkOnlyResult) is added
    // unconditionally whenever the wine has a producer/denomination, so this
    // is no longer a fully empty retailer list — but it carries no price and
    // is excluded from every stat, so the price fields stay null.
    mockSerperItems = []
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers).toHaveLength(1)
    expect(result!.retailers[0].slug).toBe('kl')
    expect(result!.retailers[0].link_only).toBe(true)
    expect(result!.price_min).toBeNull()
    expect(result!.price_avg).toBeNull()
    expect(result!.price_max).toBeNull()
    expect(result!.nearest_retailer).toBeNull()
    expect(result!.fetched_at).toBeTruthy()
  })

  it('contains only the K&L link-only entry (not a wrong price) when no Serper result is actually relevant', async () => {
    // A completely unrelated product must never be surfaced as this wine's price.
    mockSerperItems = [makeItem('Some Other Store', OTHER_URL, '$45.00')]
    mockSerperItems[0].title = 'Riedel Wine Glass Set of 6'
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers).toHaveLength(1)
    expect(result!.retailers[0].slug).toBe('kl')
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
      { title: 'Domaine Leroy Gevrey-Chambertin 2015', source: 'Zachys', link: ZACHYS_URL, price: '$50.00' },
      { title: 'Domaine Leroy Gevrey-Chambertin 2018', source: 'Benchmark Wine Group', link: BENCHMARK_URL, price: '$300.00' },
    ]
    const result = await fetchPriceData(baseWine) // baseWine.vintage === 2018
    // Zachys, Benchmark, plus the always-present K&L link-only entry
    expect(result!.retailers).toHaveLength(3)
    expect(result!.price_min).toBe(300)
    expect(result!.price_max).toBe(300)
    expect(result!.price_avg).toBe(300)
    expect(result!.nearest_retailer?.slug).toBe('benchmark')
  })

  it('flags a multi-bottle pack listing and excludes it from price stats and nearest-retailer selection', async () => {
    // A 6-pack price is not a single-bottle price — blending it into
    // price_min/avg/max (or picking it as "nearest") would inflate the
    // headline numbers by ~6x relative to what a single bottle costs.
    mockSerperItems = [
      { title: 'Domaine Leroy Gevrey-Chambertin 2018 6-Pack', source: 'Zachys', link: ZACHYS_URL, price: '$1200.00' },
      { title: 'Domaine Leroy Gevrey-Chambertin 2018', source: 'Benchmark Wine Group', link: BENCHMARK_URL, price: '$200.00' },
    ]
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(3) // Zachys, Benchmark, and the K&L link-only entry
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.pack_quantity).toBe(6)
    expect(zachys?.non_standard_format).toBe(true)
    expect(zachys?.format_label).toBe('6-pack')
    expect(result!.price_min).toBe(200)
    expect(result!.price_max).toBe(200)
    expect(result!.nearest_retailer?.slug).toBe('benchmark')
  })

  it('flags a non-standard bottle size (magnum) and excludes it from price stats', async () => {
    mockSerperItems = [
      { title: 'Domaine Leroy Gevrey-Chambertin 2018 Magnum 1.5L', source: 'Zachys', link: ZACHYS_URL, price: '$600.00' },
      { title: 'Domaine Leroy Gevrey-Chambertin 2018', source: 'Benchmark Wine Group', link: BENCHMARK_URL, price: '$200.00' },
    ]
    const result = await fetchPriceData(baseWine)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.bottle_size_ml).toBe(1500)
    expect(zachys?.non_standard_format).toBe(true)
    expect(zachys?.format_label).toBe('1.5L')
    expect(result!.price_min).toBe(200)
    expect(result!.price_max).toBe(200)
  })

  it('does not flag an ordinary single-bottle listing as non-standard format', async () => {
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$249.00')] // baseline title, no size/pack wording
    const result = await fetchPriceData(baseWine)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.pack_quantity).toBe(1)
    expect(zachys?.bottle_size_ml).toBeNull()
    expect(zachys?.non_standard_format).toBe(false)
    expect(result!.price_min).toBe(249)
  })

  it('filters Serper results to preferred retailer domains (Pass 1)', async () => {
    mockSerperItems = [
      makeItem('Zachys', ZACHYS_URL, '$249.00'),
      makeItem('Some Other Store', OTHER_URL, '$200.00'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    // Zachys (Pass 1 match) plus the always-present K&L link-only entry —
    // "Some Other Store" is correctly excluded since Pass 1 succeeded
    expect(result!.retailers).toHaveLength(2)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.is_preferred_retailer).toBe(true)
    expect(zachys?.price).toBe(249)
  })

  it('matches a preferred retailer despite formatting drift in Serper\'s source string (Pass 1)', async () => {
    // Regression guard: Serper's `source` field for a given merchant is not
    // guaranteed stable formatting (spacing, punctuation, casing). A literal
    // substring check can miss a drifted variant and silently fall through
    // to the Pass 2 fallback instead of matching the configured retailer.
    for (const source of ['ZACHYS', 'Zachys Wine & Liquor']) {
      mockSerperItems = [makeItem(source, ZACHYS_URL, '$249.00')]
      const result = await fetchPriceData(baseWine)
      const zachys = result!.retailers.find(r => r.slug === 'zachys')
      expect(zachys?.is_preferred_retailer).toBe(true)
      expect(zachys?.url).toContain('zachys.com')
    }
  })

  it('falls back to any retailer results when no preferred retailers match (Pass 2)', async () => {
    mockSerperItems = [
      makeItem('Some Other Store', OTHER_URL, '$200.00'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    const other = result!.retailers.find(r => r.slug === 'some-other-store')
    expect(other?.is_preferred_retailer).toBe(false)
  })

  it('computes price_min/avg/max from Serper prices', async () => {
    mockSerperItems = [
      makeItem('Zachys', ZACHYS_URL, '$110.00'),
      makeItem('Woodland Hills Wine Co.', WOODLAND_URL, '$120.00'),
      makeItem('Benchmark Wine Group', BENCHMARK_URL, '$130.00'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result!.price_min).toBe(110)
    expect(result!.price_max).toBe(130)
    expect(result!.price_avg).toBe(120)
  })

  it('drops a preferred retailer whose live search page reports no results', async () => {
    // Serper's shopping data can attribute a price to a retailer whose own
    // live search no longer surfaces the wine (delisted, sold out, stale
    // snapshot). The constructed search URL is rendered and checked before
    // its price is trusted — if the live page says there are no results,
    // the retailer is dropped entirely rather than shown with a price
    // nothing backs up.
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(NO_RESULTS_HTML)
    const result = await fetchPriceData(baseWine)
    // Zachys dropped; only the always-present K&L link-only entry remains
    expect(result!.retailers).toHaveLength(1)
    expect(result!.retailers[0].slug).toBe('kl')
    expect(result!.price_min).toBeNull()
  })

  it('drops a fallback retailer whose live search page reports no results', async () => {
    mockSerperItems = [makeItem('Some Other Store', OTHER_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(NO_RESULTS_HTML)
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(1) // just the K&L link-only entry
    expect(result!.retailers[0].slug).toBe('kl')
  })

  it('keeps a retailer\'s Serper price when the live-page render fails', async () => {
    // A Puppeteer timeout or network hiccup isn't evidence the retailer has
    // delisted the wine — only an explicit "no results" signal on a page
    // that did render should drop a retailer.
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(null)
    const result = await fetchPriceData(baseWine)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.price).toBe(199)
  })

  it('keeps a retailer when its live search page does show results', async () => {
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(RENDERED_HTML)
    const result = await fetchPriceData(baseWine)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.price).toBe(199)
  })

  it('identifies nearest preferred retailer to NYC by Haversine distance', async () => {
    mockSerperItems = [
      makeItem('Zachys', ZACHYS_URL, '$200.00'),
      makeItem('Benchmark Wine Group', BENCHMARK_URL, '$200.00'),
    ]
    const result = await fetchPriceData(baseWine)
    // Zachys (Westchester, NY) is much closer to NYC than Benchmark (Napa, CA)
    expect(result!.nearest_retailer?.slug).toBe('zachys')
  })

  it('includes multiple fallback retailers with independent search URLs and slugs', async () => {
    mockSerperItems = [
      makeItem('Some Other Store', OTHER_URL, '$200.00'),
      makeItem('Another Wine Shop', OTHER_URL_2, '$210.00'),
    ]
    const result = await fetchPriceData(baseWine)
    // Both fallback retailers, plus the always-present K&L link-only entry
    expect(result!.retailers).toHaveLength(3)
    const first = result!.retailers.find(r => r.slug === 'some-other-store')
    const second = result!.retailers.find(r => r.slug === 'another-wine-shop')
    expect(first?.price).toBe(200)
    expect(second?.price).toBe(210)
    expect(first?.url).not.toBe(second?.url)
  })

  it('includes fetched_at ISO timestamp', async () => {
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$249.00')]
    const result = await fetchPriceData(baseWine)
    expect(result!.fetched_at).toBeTruthy()
    expect(new Date(result!.fetched_at).getTime()).not.toBeNaN()
  })

  it('uses a constructed retailer search URL instead of the raw Serper link for preferred retailers', async () => {
    // Serper's shopping `link` often points to a Google Shopping aggregator
    // page rather than the retailer's real product page. Preferred-retailer
    // results should use the verified retailer search URL instead.
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$249.00')]
    const result = await fetchPriceData(baseWine)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.url).toBe('https://www.zachys.com/search?q=Domaine%20Leroy%20Gevrey-Chambertin%202018')
    expect(zachys?.url).not.toBe(ZACHYS_URL)
  })

  it('builds the correct search URL for each preferred retailer', async () => {
    mockSerperItems = [
      makeItem('Zachys', ZACHYS_URL, '$100.00'),
      makeItem('Woodland Hills Wine Co.', WOODLAND_URL, '$100.00'),
      makeItem('Benchmark Wine Group', BENCHMARK_URL, '$100.00'),
    ]
    const result = await fetchPriceData(baseWine)
    const bySlug = Object.fromEntries(result!.retailers.map(r => [r.slug, r.url]))
    expect(bySlug.kl).toContain('shop.klwines.com/products?searchText=') // always-present link-only entry
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
    const other = result!.retailers.find(r => r.slug === 'some-other-store')
    expect(other?.url).not.toBe(OTHER_URL)
    expect(other?.url).not.toContain('ibp=oshop')
    expect(other?.url).toContain('google.com/search?q=')
  })

  // ─── cuvee/vineyard relevance matching (2026-07-30) ───────────────────────
  // Denomination alone can be too generic to distinguish one bottling from
  // another at a wildly different price: "Drappier" + "Champagne" matches
  // both a ~$40 non-vintage Carte d'Or and a $150+ vintage "Grande Sendrée."
  // Reported live: a wine entry for Drappier "Grande Sendrée" 2012 showed
  // $39.90 and $45.98 fallback-retailer prices — plainly wrong for a
  // prestige vintage cuvee.

  const drappierWine: WineEntry = {
    ...baseWine,
    producer: 'Drappier',
    denomination: 'Champagne',
    cuvee: 'Grande Sendrée',
    vintage: 2012,
  }

  it('includes cuvee in the Serper query sent, not just producer/denomination/vintage', async () => {
    mockSerperItems = []
    await fetchPriceData(drappierWine)
    const serperCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('google.serper.dev'))
    const body = JSON.parse(serperCall![1].body)
    expect(body.q).toContain('Grande Sendrée')
  })

  it('excludes a same-producer-and-denomination listing that does not match the cuvee', async () => {
    // A cheap non-vintage Drappier Champagne listing — matches producer
    // ("Drappier") and denomination ("Champagne") but not the specific
    // "Grande Sendrée" cuvee this wine entry is for.
    mockSerperItems = [{
      title: 'Drappier Carte d\'Or Brut Champagne',
      source: 'The Wine Stop',
      link: OTHER_URL,
      price: '$39.90',
    }]
    const result = await fetchPriceData(drappierWine)
    expect(result!.retailers.find(r => r.slug === 'the-wine-stop')).toBeUndefined()
    expect(result!.price_min).toBeNull()
  })

  it('includes a listing that matches producer, denomination, and cuvee', async () => {
    mockSerperItems = [{
      title: 'Drappier Grande Sendrée Brut Champagne 2012',
      source: 'Astor Wines & Spirits',
      link: OTHER_URL,
      price: '$189.99',
    }]
    const result = await fetchPriceData(drappierWine)
    const astor = result!.retailers.find(r => r.slug === 'astor-wines-spirits')
    expect(astor?.price).toBe(189.99)
  })

  it('does not require a cuvee/vineyard match when the wine has neither set', async () => {
    // Regression guard: the added cuvee/vineyard check must not tighten
    // matching for the common case of a wine with no cuvee or vineyard.
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$249.00')] // baseWine has no cuvee/vineyard
    const result = await fetchPriceData(baseWine)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.price).toBe(249)
  })

  // ─── K&L link-only behavior (2026-07-30) ──────────────────────────────────
  // K&L's own site blocks Puppeteer behind a bot-detection challenge
  // ("Verification Required" slider stub, confirmed live), so its price can
  // never actually be verified — and a Serper-sourced K&L "match" must never
  // be treated as a Pass 1 success, or a wine only K&L happens to carry
  // would stop the cascade with nothing usable instead of falling through to
  // real, verifiable retailers.

  it('always includes a K&L link-only entry, even when Serper finds nothing at all', async () => {
    mockSerperItems = []
    const result = await fetchPriceData(baseWine)
    const kl = result!.retailers.find(r => r.slug === 'kl')
    expect(kl).toBeDefined()
    expect(kl?.link_only).toBe(true)
    expect(kl?.price).toBeNull()
    expect(kl?.url).toContain('shop.klwines.com/products?searchText=')
  })

  it('builds K&L\'s link-only URL without a vintage token, straight from RETAILER_CONFIG', async () => {
    // Same reasoning as retailer-links/index.ts's buildQuery (Phase 7.2):
    // K&L's on-site search is literal enough that an added vintage risks a
    // false "no results" even when K&L carries the wine under a different
    // vintage's listing.
    mockSerperItems = []
    const result = await fetchPriceData(baseWine) // baseWine.vintage === 2018
    const kl = result!.retailers.find(r => r.slug === 'kl')
    expect(kl?.url).toBe('https://shop.klwines.com/products?searchText=Domaine%20Leroy%20Gevrey-Chambertin')
    expect(kl?.url).not.toContain('2018')
  })

  it('does not let a Serper-matched K&L item satisfy Pass 1 and stop the cascade', async () => {
    // Before this fix, K&L alone matching Pass 1 would return only K&L,
    // dropping every other Serper result on the floor.
    mockSerperItems = [
      makeItem('K&L Wine Merchants', KL_URL, '$199.00'),
      makeItem('Some Other Store', OTHER_URL, '$210.00'),
    ]
    const result = await fetchPriceData(baseWine)
    const other = result!.retailers.find(r => r.slug === 'some-other-store')
    expect(other).toBeDefined()
    expect(other?.price).toBe(210)
    expect(other?.is_preferred_retailer).toBe(false)
    const kl = result!.retailers.find(r => r.slug === 'kl')
    expect(kl?.link_only).toBe(true)
    expect(kl?.price).toBeNull()
  })

  it('never produces a Serper-priced K&L entry, only the link-only one, even when K&L is the sole Serper result', async () => {
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$199.00')]
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(1)
    const kl = result!.retailers[0]
    expect(kl.slug).toBe('kl')
    expect(kl.link_only).toBe(true)
    expect(kl.price).toBeNull()
    expect(kl.url).not.toBe(KL_URL)
  })

  it('never duplicates K&L when Serper returns both a K&L item and a real preferred-retailer match', async () => {
    mockSerperItems = [
      makeItem('K&L Wine Merchants', KL_URL, '$199.00'),
      makeItem('Zachys', ZACHYS_URL, '$210.00'),
    ]
    const result = await fetchPriceData(baseWine)
    const klEntries = result!.retailers.filter(r => r.slug === 'kl')
    expect(klEntries).toHaveLength(1)
    expect(klEntries[0].link_only).toBe(true)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.price).toBe(210)
    expect(zachys?.link_only).toBeFalsy()
  })

  it('excludes K&L from Serper matching even when its source string has drifted formatting', async () => {
    for (const source of ['K & L Wine Merchants', 'KLWines.com']) {
      mockSerperItems = [makeItem(source, KL_URL, '$249.00')]
      const result = await fetchPriceData(baseWine)
      expect(result!.retailers).toHaveLength(1)
      const kl = result!.retailers[0]
      expect(kl.slug).toBe('kl')
      expect(kl.link_only).toBe(true)
      expect(kl.price).toBeNull()
    }
  })

  it('never renders or verifies K&L\'s page — its link-only entry bypasses verify-listing entirely', async () => {
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$199.00')]
    await fetchPriceData(baseWine)
    expect(mockRenderPageHtml).not.toHaveBeenCalled()
  })

  it('never selects K&L\'s link-only entry as nearest_retailer, even with no other preferred-retailer results', async () => {
    mockSerperItems = []
    const result = await fetchPriceData(baseWine)
    expect(result!.nearest_retailer).toBeNull()
  })

  it('excludes K&L\'s link-only entry from price_min/avg/max alongside real prices', async () => {
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$150.00')]
    const result = await fetchPriceData(baseWine)
    expect(result!.price_min).toBe(150)
    expect(result!.price_avg).toBe(150)
    expect(result!.price_max).toBe(150)
  })
})

// ─── aggregatePriceData (Phase 7.2) ────────────────────────────────────────────
// Extracted from fetchPriceData so the confirm-retailer-link route (which
// updates one retailer's entry outside the normal Serper flow) can recompute
// the aggregate without duplicating this math.

function makeRetailer(overrides: Partial<RetailerResult> = {}): RetailerResult {
  return {
    slug: 'kl',
    name: 'K&L Wine Merchants',
    price: 100,
    url: 'https://shop.klwines.com/x',
    is_preferred_retailer: true,
    distance_miles: 3,
    is_search_results_page: true,
    matched_vintage: null,
    vintage_mismatch: false,
    vintage_verdict: 'unknown',
    pack_quantity: 1,
    bottle_size_ml: null,
    non_standard_format: false,
    format_label: '',
    link_only: false,
    ...overrides,
  }
}

describe('aggregatePriceData', () => {
  it('computes min/avg/max across all priced retailers', () => {
    const result = aggregatePriceData([
      makeRetailer({ price: 100 }),
      makeRetailer({ slug: 'zachys', price: 200 }),
      makeRetailer({ slug: 'benchmark', price: 300 }),
    ])
    expect(result.price_min).toBe(100)
    expect(result.price_max).toBe(300)
    expect(result.price_avg).toBe(200)
  })

  it('excludes vintage_mismatch and non_standard_format listings from the aggregate stats', () => {
    const result = aggregatePriceData([
      makeRetailer({ price: 100 }),
      makeRetailer({ slug: 'zachys', price: 9999, vintage_mismatch: true }),
      makeRetailer({ slug: 'benchmark', price: 9999, non_standard_format: true }),
    ])
    expect(result.price_min).toBe(100)
    expect(result.price_max).toBe(100)
    expect(result.price_avg).toBe(100)
  })

  it('excludes link_only listings from the aggregate stats and nearest-retailer selection', () => {
    const result = aggregatePriceData([
      makeRetailer({ slug: 'kl', price: null, link_only: true, distance_miles: 0 }),
      makeRetailer({ slug: 'zachys', price: 200, distance_miles: 25 }),
    ])
    expect(result.price_min).toBe(200)
    expect(result.price_max).toBe(200)
    expect(result.price_avg).toBe(200)
    expect(result.nearest_retailer?.slug).toBe('zachys')
  })

  it('picks the nearest preferred retailer as nearest_retailer', () => {
    const result = aggregatePriceData([
      makeRetailer({ slug: 'benchmark', distance_miles: 50 }),
      makeRetailer({ slug: 'zachys', distance_miles: 3 }),
    ])
    expect(result.nearest_retailer?.slug).toBe('zachys')
  })

  it('still includes all retailers in the returned list, even ones excluded from stats', () => {
    const result = aggregatePriceData([
      makeRetailer({ price: 100 }),
      makeRetailer({ slug: 'zachys', price: 9999, vintage_mismatch: true }),
    ])
    expect(result.retailers).toHaveLength(2)
  })

  it('returns null stats when no retailer has a price', () => {
    const result = aggregatePriceData([makeRetailer({ price: null })])
    expect(result.price_min).toBeNull()
    expect(result.price_avg).toBeNull()
    expect(result.price_max).toBeNull()
  })
})
