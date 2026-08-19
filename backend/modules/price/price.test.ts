import { fetchPriceData, aggregatePriceData, excludeOutliers, excludeExtremeOutliers } from './index'
import { pageMentionsProducer } from './verify-listing'
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

// A retailer search page that actually shows this wine. It has to name the
// producer: as of Phase 9.1, verify-listing asks the page directly whether
// every significant producer word is present, rather than only scanning for
// one of eight English "no results" phrasings (see pageMentionsProducer).
const RENDERED_HTML =
  '<html><body><p>12 results</p><a href="/p/1">Domaine Leroy Gevrey-Chambertin 2018</a><span class="price">$249.00</span></body></html>'
const NO_RESULTS_HTML = '<html><body><p>0 Results</p><p>No results.</p></body></html>'
// Renders fine, says nothing about "no results", and is about a different
// producer entirely — the shape that let Benchmark, Zachys, Woodland Hills
// and Flatiron all pass the old negative-only check while serving dead links.
const WRONG_PRODUCER_HTML =
  '<html><body><p>6 results</p><a href="/p/2">Louis Jadot Gevrey-Chambertin 2018</a></body></html>'

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
  promoted_at: '2024-01-01T00:00:00.000Z',
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

  // ─── A failed search must never look like an empty one (2026-08-05) ─────
  // Found by running the 14-wine batch: a burst of concurrent Serper calls
  // rate limited, querySerper caught the failure and returned an empty
  // result, and the route stored that over eight wines' real retailer lists.
  // The same wines queried one at a time returned five retailers in two
  // seconds. Returning null routes it to the same "never attempted" path as
  // a missing API key, so nothing is written.
  it('returns null — writing nothing — when the Serper request fails', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('rate limited', { status: 429 }))
    )

    expect(await fetchPriceData(baseWine)).toBeNull()
  })

  it('returns null when the Serper request throws outright', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => Promise.reject(new Error('socket hang up')))

    expect(await fetchPriceData(baseWine)).toBeNull()
  })

  it('still distinguishes a successful empty search from a failed one', async () => {
    // HTTP 200 with no shopping results is a real finding, and storing it is
    // correct — that is the honest empty state.
    mockSerperItems = []
    const result = await fetchPriceData(baseWine)

    expect(result).not.toBeNull()
    expect(result!.retailers).toHaveLength(0)
    expect(result!.fetched_at).toBeTruthy()
  })

  it('reports an honest empty state when Serper returns no results', async () => {
    // Phase 9.1: K&L's link-only entry is no longer appended unconditionally,
    // so this path is reachable again. An empty retailers list with a
    // fetched_at timestamp is "attempted and found nothing" — which the UI
    // must be able to tell apart from "never attempted" (a null price_data).
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

  it('returns no retailer at all (not a wrong price) when no Serper result is actually relevant', async () => {
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
      { title: 'Domaine Leroy Gevrey-Chambertin 2015', source: 'Zachys', link: ZACHYS_URL, price: '$50.00' },
      { title: 'Domaine Leroy Gevrey-Chambertin 2018', source: 'Benchmark Wine Group', link: BENCHMARK_URL, price: '$300.00' },
    ]
    const result = await fetchPriceData(baseWine) // baseWine.vintage === 2018
    // Zachys and Benchmark. K&L is no longer appended unconditionally
    // (Phase 9.1) — Serper showed no K&L listing for this wine.
    expect(result!.retailers).toHaveLength(2)
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
    expect(result!.retailers).toHaveLength(2) // Zachys and Benchmark; K&L is gated (Phase 9.1)
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

  it('identifies a preferred retailer as such, and lists it ahead of fallback results (Pass 1)', async () => {
    mockSerperItems = [
      makeItem('Zachys', ZACHYS_URL, '$249.00'),
      makeItem('Some Other Store', OTHER_URL, '$200.00'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.is_preferred_retailer).toBe(true)
    expect(zachys?.price).toBe(249)
    // Preferred first: they carry real coordinates, a constructed on-site
    // URL and a price verify-listing can actually check.
    expect(result!.retailers[0].slug).toBe('zachys')
  })

  // ─── Pass 1 no longer short-circuits Pass 2 (Phase 9.1, WI-6) ────────────
  // `if (preferred.length > 0) return preferred` meant a single
  // preferred-retailer match suppressed every other retailer for the wine.
  // Grand Village matched Zachys on a 2023 listing, which then failed the
  // vintage filter and left price_min/avg/max all null — one dead link, and
  // the fallback that would have found the other shops never ran.
  describe('merged preferred and fallback passes', () => {
    it('keeps fallback retailers alongside a preferred match', async () => {
      mockSerperItems = [
        makeItem('Zachys', ZACHYS_URL, '$249.00'),
        makeItem('Some Other Store', OTHER_URL, '$200.00'),
      ]

      const result = await fetchPriceData(baseWine)
      const slugs = result!.retailers.map(r => r.slug)

      expect(slugs).toContain('zachys')
      expect(slugs).toContain('some-other-store')
    })

    it('still prices a wine whose only preferred match is a wrong vintage', async () => {
      // The Grand Village shape, exactly: Zachys on a different year (so
      // excluded from the stats), with a usable fallback price behind it
      // that the short-circuit used to hide.
      mockSerperItems = [
        { title: 'Domaine Leroy Gevrey-Chambertin 2023', source: 'Zachys', link: ZACHYS_URL, price: '$400.00' },
        makeItem('Some Other Store', OTHER_URL, '$200.00'),
      ]

      const result = await fetchPriceData(baseWine)

      expect(result!.retailers.find(r => r.slug === 'zachys')?.vintage_mismatch).toBe(true)
      expect(result!.price_min).toBe(200)
      expect(result!.price_avg).toBe(200)
    })

    it('does not list the same shop twice when it matches as both a configured retailer and a raw Serper source', async () => {
      // The configured slug comes from RETAILER_CONFIG ('benchmark'); the
      // fallback slug is derived from Serper's merchant string
      // ('benchmark-wine-group'), so deduplicating on slug alone would let
      // one shop through under two names.
      mockSerperItems = [makeItem('Benchmark Wine Group', BENCHMARK_URL, '$200.00')]

      const result = await fetchPriceData(baseWine)
      const benchmarkish = result!.retailers.filter(r => r.name.toLowerCase().includes('benchmark'))

      expect(benchmarkish).toHaveLength(1)
      expect(benchmarkish[0].slug).toBe('benchmark')
      expect(benchmarkish[0].is_preferred_retailer).toBe(true)
    })

    it('does not re-list a configured retailer as a fallback when it has two listings', async () => {
      // Live-confirmed 2026-08-05: Grand Village showed both `zachys` and
      // `zachys-wine-spirits`. Pass 1 claims one listing per retailer, so the
      // second fell through to Pass 2 and reappeared under a slugified source.
      mockSerperItems = [
        { title: 'Domaine Leroy Gevrey-Chambertin 2018', source: 'Zachys', link: ZACHYS_URL, price: '$249.00' },
        { title: 'Domaine Leroy Gevrey-Chambertin 2018', source: 'Zachys Wine & Spirits', link: ZACHYS_URL, price: '$199.00' },
      ]

      const result = await fetchPriceData(baseWine)
      const zachysish = result!.retailers.filter(r => r.name.toLowerCase().includes('zachys'))

      expect(zachysish).toHaveLength(1)
      expect(zachysish[0].slug).toBe('zachys')
      expect(zachysish[0].is_preferred_retailer).toBe(true)
    })

    it('tops non-preferred retailers up to the target and no further', async () => {
      mockSerperItems = Array.from({ length: 15 }, (_, i) => ({
        title: 'Domaine Leroy Gevrey-Chambertin 2018',
        source: `Wine Shop ${i}`,
        link: `https://shop${i}.example.com/p`,
        price: '$200.00',
      }))

      const result = await fetchPriceData(baseWine)

      // No preferred retailer matched, so non-preferred fill to the target.
      expect(result!.retailers.filter(r => !r.link_only)).toHaveLength(5)
    })

    it('returns every preferred retailer, even beyond the target, and adds no fallback', async () => {
      // The target governs how far non-preferred results top the list up. It
      // is not a cap on the shops the developer actually buys from.
      mockSerperItems = [
        makeItem('Zachys', ZACHYS_URL, '$100.00'),
        makeItem('Woodland Hills Wine Co.', WOODLAND_URL, '$110.00'),
        makeItem('Benchmark Wine Group', BENCHMARK_URL, '$120.00'),
        makeItem('Sokolin', 'https://www.sokolin.com/p', '$130.00'),
        makeItem('Acker Wines', 'https://www.ackerwines.com/p', '$140.00'),
        makeItem('Wine Library', 'https://www.winelibrary.com/p', '$150.00'),
        makeItem('Some Other Store', OTHER_URL, '$160.00'),
      ]

      const result = await fetchPriceData(baseWine)
      const preferred = result!.retailers.filter(r => r.is_preferred_retailer && !r.link_only)

      expect(preferred.length).toBeGreaterThan(5)
      // Target already met by preferred alone — no fallback was needed.
      expect(result!.retailers.find(r => r.slug === 'some-other-store')).toBeUndefined()
    })

    it('tops up with non-preferred when preferred alone fall short', async () => {
      mockSerperItems = [
        makeItem('Zachys', ZACHYS_URL, '$100.00'),
        makeItem('Some Other Store', OTHER_URL, '$160.00'),
        makeItem('Another Wine Shop', OTHER_URL_2, '$170.00'),
        makeItem('Third Wine Shop', 'https://third.example.com/p', '$180.00'),
        makeItem('Fourth Wine Shop', 'https://fourth.example.com/p', '$190.00'),
        makeItem('Fifth Wine Shop', 'https://fifth.example.com/p', '$195.00'),
      ]

      const result = await fetchPriceData(baseWine)
      const serperSourced = result!.retailers.filter(r => !r.link_only)

      expect(serperSourced).toHaveLength(5)
      // Preferred first.
      expect(serperSourced[0].slug).toBe('zachys')
    })
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
    // Zachys dropped, and nothing is appended in its place.
    expect(result!.retailers).toHaveLength(0)
    expect(result!.price_min).toBeNull()
  })

  // Was: "drops a fallback retailer whose live search page reports no
  // results." That assertion was never reachable in production (2026-08-05).
  // A fallback retailer's URL is a constructed google.com/search, and Google
  // serves Puppeteer a javascript interstitial — never a retailer's
  // "no results" copy. The verification was vacuous either way, so it is no
  // longer attempted; see isRetailerOwnPage.
  it('does not drop a fallback retailer on the strength of a page that is not the retailer\'s', async () => {
    mockSerperItems = [makeItem('Some Other Store', OTHER_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(NO_RESULTS_HTML)

    const result = await fetchPriceData(baseWine)
    const other = result!.retailers.find(r => r.slug === 'some-other-store')

    expect(other?.price).toBe(199)
    expect(other?.verification).toBe('unverified')
  })

  // ─── Fail-closed verification (Phase 9.1, WI-8) ──────────────────────────
  describe('verification state', () => {
    it('drops a retailer whose page rendered but is about a different producer', async () => {
      // pageShowsNoResults is an allowlist of eight English phrasings, so a
      // retailer whose empty state isn't on it passed by default — Benchmark,
      // Zachys, Woodland Hills and Flatiron all did, while serving dead
      // links. Asking whether the producer is named answers it directly.
      mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$199.00')]
      mockRenderPageHtml.mockResolvedValue(WRONG_PRODUCER_HTML)

      const result = await fetchPriceData(baseWine)

      expect(result!.retailers).toHaveLength(0)
    })

    it('marks a retailer verified when its live page names the producer', async () => {
      mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$199.00')]
      mockRenderPageHtml.mockResolvedValue(RENDERED_HTML)

      const result = await fetchPriceData(baseWine)

      expect(result!.retailers.find(r => r.slug === 'zachys')?.verification).toBe('verified')
    })

    // Live-confirmed regression, 2026-08-05. A Pass 2 fallback retailer's URL
    // is a constructed google.com/search — rendering it asks Google, not the
    // shop, and Google serves Puppeteer a ~3.4KB "please enable javascript"
    // interstitial. That interstitial never contains a "no results" phrase, so
    // fallback retailers used to pass vacuously; once Phase 9.1 added the
    // producer check they failed vacuously instead, silently dropping every
    // Pass 2 retailer that had a real price. Across the 14-wine batch that
    // took priced retailers from 30 to 8 and left 0 of 14 wines with any
    // price at all.
    it('keeps a fallback retailer whose google.com search URL cannot name the producer', async () => {
      mockSerperItems = [makeItem('Some Other Store', OTHER_URL, '$200.00')]
      mockRenderPageHtml.mockResolvedValue(
        '<html><body>In order to continue, please enable javascript</body></html>'
      )

      const result = await fetchPriceData(baseWine)
      const other = result!.retailers.find(r => r.slug === 'some-other-store')

      expect(other).toBeDefined()
      expect(other!.price).toBe(200)
      // Honest: we never actually checked the shop.
      expect(other!.verification).toBe('unverified')
      expect(result!.price_min).toBe(200)
    })

    it('does not spend a render on a URL that is not the retailer\'s own site', async () => {
      mockSerperItems = [makeItem('Some Other Store', OTHER_URL, '$200.00')]
      mockRenderPageHtml.mockResolvedValue(RENDERED_HTML)

      await fetchPriceData(baseWine)

      expect(mockRenderPageHtml).not.toHaveBeenCalledWith(expect.stringContaining('google.com/search'))
    })

    it('still verifies a preferred retailer against its own site', async () => {
      mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$249.00')]
      mockRenderPageHtml.mockResolvedValue(RENDERED_HTML)

      const result = await fetchPriceData(baseWine)

      expect(mockRenderPageHtml).toHaveBeenCalledWith(expect.stringContaining('zachys.com'))
      expect(result!.retailers.find(r => r.slug === 'zachys')?.verification).toBe('verified')
    })

    it('marks a retailer unverified — not verified — when the render fails', async () => {
      // An infra hiccup still isn't evidence the wine is gone, so the price
      // is kept. It just may no longer be presented as though it were checked.
      mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$199.00')]
      mockRenderPageHtml.mockResolvedValue(null)

      const result = await fetchPriceData(baseWine)
      const zachys = result!.retailers.find(r => r.slug === 'zachys')

      expect(zachys?.price).toBe(199)
      expect(zachys?.verification).toBe('unverified')
    })

  })

  describe('pageMentionsProducer', () => {
    it('confirms a page naming every significant producer word', () => {
      expect(pageMentionsProducer(RENDERED_HTML, 'Domaine Leroy')).toBe(true)
    })

    it('rejects a page about a different producer', () => {
      expect(pageMentionsProducer(WRONG_PRODUCER_HTML, 'Domaine Leroy')).toBe(false)
    })

    it('requires every significant word, not just one', () => {
      // "Domaine" is a stopword, so this asks for both "jean" and "vincent".
      const partial = '<html><body><a>Vincent Girardin Santenay</a></body></html>'
      expect(pageMentionsProducer(partial, 'Domaine Jean-Marc Vincent')).toBe(false)
    })

    it('folds diacritics and punctuation on both sides', () => {
      const html = '<html><body><a>Chateau Gour de Chaule Gigondas</a></body></html>'
      expect(pageMentionsProducer(html, 'Château Gour de Chaulé')).toBe(true)
    })

    it('returns null — not false — when there is no producer to look for', () => {
      // "Couldn't ask" is not "asked and the answer was no". The caller maps
      // this to 'unverified' rather than dropping the retailer.
      expect(pageMentionsProducer(RENDERED_HTML, null)).toBeNull()
      expect(pageMentionsProducer(RENDERED_HTML, 'Domaine')).toBeNull()
    })
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
    // Both fallback retailers; K&L is gated (Phase 9.1)
    expect(result!.retailers).toHaveLength(2)
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
    expect(zachys?.url).toBe('https://www.zachys.com/search?q=Domaine%20Leroy%20Gevrey-Chambertin')
    expect(zachys?.url).not.toBe(ZACHYS_URL)
  })

  // ─── Dead retailer links (Phase 9.1, WI-4) ───────────────────────────────
  // Six for six of the dead links reported against the 2026-08-04 batch were
  // the same mechanism: buildQuery included the vintage, and that same string
  // was handed to buildRetailerSearchUrl. When Serper matched a retailer on a
  // different vintage, the app stored that retailer and then built a link
  // asking their site for a year they don't stock. A retailer's own search is
  // literal, not relevance-ranked, so the added year turns a page of real
  // listings into "no results" — the call retailer-links/index.ts already
  // made in Phase 7.2 with a live-confirmed Zachys example.
  describe('constructed retailer URLs carry no vintage token', () => {
    it('omits the vintage from every constructed URL, preferred and fallback alike', async () => {
      mockSerperItems = [
        makeItem('Zachys', ZACHYS_URL, '$249.00'),
        makeItem('Benchmark Wine Group', BENCHMARK_URL, '$200.00'),
        makeItem('Some Other Store', OTHER_URL, '$180.00'),
      ]

      const result = await fetchPriceData(baseWine)

      expect(result!.retailers.length).toBeGreaterThan(0)
      for (const r of result!.retailers) {
        expect(r.url).not.toContain('2018')
      }
    })

    it('still sends the vintage to Serper — it narrows Shopping, it just must not narrow the shop', async () => {
      mockSerperItems = []
      await fetchPriceData(baseWine)
      const body = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))
      expect(body.q).toContain('2018')
    })

    it('links a retailer matched on a different vintage to a query that can actually find the wine', async () => {
      // Grand Village matched Zachys on a 2023 listing and was then linked
      // with 2022. The listing is still flagged as a different year; the link
      // is no longer a dead end.
      mockSerperItems = [
        { title: 'Domaine Leroy Gevrey-Chambertin 2016', source: 'Zachys', link: ZACHYS_URL, price: '$300.00' },
      ]

      const result = await fetchPriceData(baseWine)
      const zachys = result!.retailers.find(r => r.slug === 'zachys')

      expect(zachys?.vintage_mismatch).toBe(true)
      expect(zachys?.matched_vintage).toBe(2016)
      expect(zachys?.url).not.toContain('2016')
      expect(zachys?.url).not.toContain('2018')
    })
  })

  it('builds the correct search URL for each preferred retailer', async () => {
    mockSerperItems = [
      makeItem('Zachys', ZACHYS_URL, '$100.00'),
      makeItem('Woodland Hills Wine Co.', WOODLAND_URL, '$100.00'),
      makeItem('Benchmark Wine Group', BENCHMARK_URL, '$100.00'),
    ]
    const result = await fetchPriceData(baseWine)
    const bySlug = Object.fromEntries(result!.retailers.map(r => [r.slug, r.url]))
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

  // verify-listing now asks whether the rendered page names *this* wine's
  // producer (Phase 9.1), so this block needs a page about Drappier rather
  // than the Domaine Leroy default.
  const DRAPPIER_HTML =
    '<html><body><p>4 results</p><a href="/p/3">Drappier Grande Sendree Brut Champagne 2012</a></body></html>'

  it('includes cuvee in the Serper query sent, not just producer/denomination/vintage', async () => {
    mockSerperItems = []
    await fetchPriceData(drappierWine)
    const serperCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('google.serper.dev'))
    const body = JSON.parse(serperCall![1].body)
    // Diacritics folded as of Phase 9.1 — the Shopping query no longer
    // demands an exact accented string the matcher itself would have folded.
    expect(body.q).toContain('Grande Sendree')
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
    mockRenderPageHtml.mockResolvedValue(DRAPPIER_HTML)
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

  // Gated as of Phase 9.1: offered only when Serper's Shopping snapshot
  // actually showed a relevant K&L listing. "K&L's price can't be verified"
  // was being conflated with "we have no idea whether K&L stocks it" —
  // Deleuze-Rochetin's entire retailer list was one K&L entry for a wine K&L
  // doesn't stock, and Mangot's was too.
  it('offers the K&L link when Serper showed a relevant K&L listing', async () => {
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$199.00')]
    const result = await fetchPriceData(baseWine)
    const kl = result!.retailers.find(r => r.slug === 'kl')
    expect(kl).toBeDefined()
    expect(kl?.link_only).toBe(true)
    expect(kl?.price).toBeNull()
    expect(kl?.url).toContain('shop.klwines.com/products?searchText=')
  })

  it('does not invent a K&L entry when Serper showed no K&L listing at all', async () => {
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$249.00')]
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers.find(r => r.slug === 'kl')).toBeUndefined()
  })

  it('does not offer the K&L link on the strength of an irrelevant K&L listing', async () => {
    // The snapshot has to be evidence about *this* wine. A K&L listing for
    // glassware is not.
    mockSerperItems = [{ title: 'Riedel Wine Glass Set of 6', source: 'K&L Wine Merchants', link: KL_URL, price: '$60.00' }]
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers.find(r => r.slug === 'kl')).toBeUndefined()
  })

  it('builds K&L\'s link-only URL without a vintage token, straight from RETAILER_CONFIG', async () => {
    // Same reasoning as retailer-links/index.ts's buildQuery (Phase 7.2):
    // K&L's on-site search is literal enough that an added vintage risks a
    // false "no results" even when K&L carries the wine under a different
    // vintage's listing.
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$199.00')]
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

// ─── Cross-feed from modules/reviews/ (Phase 9.1, WI-7) ────────────────────
// A product page reviews/ already rendered and matched is the strongest
// evidence a shop carries the wine. reviews/ found a live Woodland Hills
// product page for Mangot 2022 with 7 critic scores in the same run price/
// returned zero retailers for it. Supplied by the router, never imported —
// modules don't import each other (CLAUDE.md §5).
describe('fetchPriceData — confirmed product pages from reviews', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.SERPER_API_KEY = 'test-serper-key'
    mockRenderPageHtml.mockResolvedValue(RENDERED_HTML)
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.SERPER_API_KEY
  })

  const woodlandPage = {
    slug: 'woodland',
    name: 'Woodland Hills Wine Co.',
    product_url: 'https://whwc.com/mangot-st-emilion-2022/',
    price: null,
  }

  it('adds a retailer Serper found nothing for, pointing at the confirmed product page', async () => {
    mockSerperItems = []

    const result = await fetchPriceData(baseWine, { confirmedProductPages: [woodlandPage] })
    const woodland = result!.retailers.find(r => r.slug === 'woodland')

    expect(woodland).toBeDefined()
    expect(woodland!.url).toBe(woodlandPage.product_url)
    // A real product page, not a constructed search — the only entry in this
    // module for which that is true.
    expect(woodland!.is_search_results_page).toBe(false)
    expect(woodland!.is_preferred_retailer).toBe(true)
  })

  it('carries no price and stays out of the headline stats', async () => {
    // The pipeline never saw a price for this shop. Lifting one off a review
    // page would be blending across sources (CLAUDE.md §15).
    mockSerperItems = [makeItem('Zachys', ZACHYS_URL, '$249.00')]

    const result = await fetchPriceData(baseWine, { confirmedProductPages: [woodlandPage] })
    const woodland = result!.retailers.find(r => r.slug === 'woodland')

    expect(woodland!.price).toBeNull()
    expect(woodland!.link_only).toBe(true)
    expect(result!.price_min).toBe(249)
    expect(result!.price_avg).toBe(249)
    expect(result!.nearest_retailer?.slug).not.toBe('woodland')
  })

  it('does not displace a retailer that already has a real Serper price', async () => {
    mockSerperItems = [makeItem('Woodland Hills Wine Co.', WOODLAND_URL, '$180.00')]

    const result = await fetchPriceData(baseWine, { confirmedProductPages: [woodlandPage] })
    const woodlandEntries = result!.retailers.filter(r => r.slug === 'woodland')

    expect(woodlandEntries).toHaveLength(1)
    expect(woodlandEntries[0].price).toBe(180)
  })

  it('does not duplicate K&L when reviews also confirmed a K&L product page', async () => {
    // Live-confirmed regression from the 2026-08-05 re-run: Grand Village and
    // Gour de Chaulé each came back with two K&L rows. modules/reviews/
    // searches K&L like any other configured retailer and often finds a
    // product page there — Serper's organic index isn't blocked, only the
    // render is — so the cross-feed contributes a 'kl' entry, and the
    // always-appended K&L link duplicated it.
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$199.00')]

    const result = await fetchPriceData(baseWine, {
      confirmedProductPages: [
        { slug: 'kl', name: 'K&L Wine Merchants', product_url: 'https://shop.klwines.com/products/details/1557135', price: null },
      ],
    })
    const klEntries = result!.retailers.filter(r => r.slug === 'kl')

    expect(klEntries).toHaveLength(1)
    // The confirmed product page wins — it points at the actual product
    // rather than a search for it.
    expect(klEntries[0].url).toBe('https://shop.klwines.com/products/details/1557135')
    expect(klEntries[0].is_search_results_page).toBe(false)
  })

  it('accepts a page from a shop that is not in RETAILER_CONFIG', async () => {
    mockSerperItems = []

    const result = await fetchPriceData(baseWine, {
      confirmedProductPages: [
        { slug: 'fallback-sommpicks-com', name: 'sommpicks.com', product_url: 'https://sommpicks.com/p/1', price: null },
      ],
    })
    const somm = result!.retailers.find(r => r.slug === 'fallback-sommpicks-com')

    expect(somm).toBeDefined()
    expect(somm!.is_preferred_retailer).toBe(false)
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
    verification: 'verified',
    ...overrides,
  }
}

// ─── Price aggregation hardening (2026-08-05) ──────────────────────────────
// Reported after manual testing: "the min, avg, max price seems broken."
// Two causes — implausible listings setting price_max, and a blank card
// whenever the only prices found were for another vintage.
describe('excludeOutliers', () => {
  it('drops a price wildly out of line with the rest', () => {
    // Real: Dureuil-Janthial came back $145 / $196 / $724 / $2,044.76, all
    // titled as ordinary 750ml bottles. $2,044 is a case or a data error.
    const kept = excludeOutliers([145, 196, 180, 210, 2044.76])
    expect(kept).not.toContain(2044.76)
    expect(kept).toContain(145)
    expect(kept).toContain(210)
  })

  it('leaves a genuinely wide but plausible spread alone', () => {
    // Burgundy really does span this much; the test must not "tidy" it.
    // This is the case that forces the fence into log space: an additive
    // fence loose enough to keep $430 here also keeps a $1,486 Chablis.
    expect(excludeOutliers([86, 99.89, 135, 144.99, 240, 430])).toHaveLength(6)
  })

  it('rejects a price an order of magnitude above a tight cluster', () => {
    // Bessin-Tremblay, live 2026-08-05: $37.99 / $84.99 / $119.95 / $1,486.
    // The $1,486 survived an additive 3×IQR fence.
    expect(excludeOutliers([37.99, 84.99, 119.95, 1486])).not.toContain(1486)
  })

  it('ignores a non-positive price rather than taking its logarithm', () => {
    expect(excludeOutliers([0, 30, 40, 50])).toEqual([0, 30, 40, 50])
  })

  it('does nothing with fewer than four prices', () => {
    // No distribution to reason about — discarding one of three real prices
    // is a bigger error than keeping one bad one.
    expect(excludeOutliers([30, 40, 900])).toEqual([30, 40, 900])
  })

  it('handles an all-identical set without dividing by a zero spread', () => {
    expect(excludeOutliers([50, 50, 50, 50])).toEqual([50, 50, 50, 50])
  })

  it('never returns an empty set', () => {
    expect(excludeOutliers([1, 2, 3, 1000]).length).toBeGreaterThan(0)
  })
})

// ─── other_vintage_price_range small-n fence (2026-08-12) ──────────────────
// Reported: Bessin-Tremblay's other-vintage range still showed $1,486 after
// the 2026-08-05 fix. Cause: that run's vintage_mismatch set had only three
// prices ($37.99 / $84.99 / $1,486), and excludeOutliers is a no-op below
// four — by design, since quartiles need more points than that to mean
// anything, and (confirmed separately) even lowering the four-price gate
// wouldn't have helped: at n=3 the $1,486 is one of the only three points
// feeding its own IQR fence, which pulls wide enough to let it through.
describe('excludeExtremeOutliers', () => {
  it('drops a price an order of magnitude off a 3-price set', () => {
    // The actual Bessin-Tremblay 2026-08-12 vintage_mismatch set.
    const kept = excludeExtremeOutliers([37.99, 84.99, 1486])
    expect(kept).not.toContain(1486)
    expect(kept).toEqual(expect.arrayContaining([37.99, 84.99]))
  })

  it('leaves a plausible 3-price spread alone', () => {
    expect(excludeExtremeOutliers([39.97, 40.5, 59.99])).toEqual([39.97, 40.5, 59.99])
  })

  it('does nothing with fewer than three prices', () => {
    expect(excludeExtremeOutliers([30, 900])).toEqual([30, 900])
    expect(excludeExtremeOutliers([30])).toEqual([30])
  })

  it('ignores a non-positive price rather than dividing by it', () => {
    expect(excludeExtremeOutliers([0, 30, 40])).toEqual([0, 30, 40])
  })

  it('never returns an empty set', () => {
    expect(excludeExtremeOutliers([1, 2, 3000]).length).toBeGreaterThan(0)
  })
})

describe('other-vintage price range', () => {
  it('reports a range when every price found is for a different vintage', () => {
    // Ardoisières had five real prices and displayed nothing at all.
    const result = aggregatePriceData([
      makeRetailer({ slug: 'a', price: 28, vintage_mismatch: true }),
      makeRetailer({ slug: 'b', price: 40, vintage_mismatch: true }),
      makeRetailer({ slug: 'c', price: 149.95, vintage_mismatch: true }),
    ])

    expect(result.price_min).toBeNull()
    expect(result.other_vintage_price_range).toEqual({ min: 28, max: 149.95 })
  })

  it('keeps wrong-vintage prices out of the headline figures', () => {
    const result = aggregatePriceData([
      makeRetailer({ slug: 'right', price: 60 }),
      makeRetailer({ slug: 'wrong', price: 500, vintage_mismatch: true }),
    ])

    expect(result.price_min).toBe(60)
    expect(result.price_max).toBe(60)
    expect(result.other_vintage_price_range).toEqual({ min: 500, max: 500 })
  })

  it('is null when nothing was found for another vintage', () => {
    const result = aggregatePriceData([makeRetailer({ price: 60 })])
    expect(result.other_vintage_price_range).toBeNull()
  })

  it('excludes non-standard formats from the other-vintage range too', () => {
    // A wrong-vintage magnum tells you even less than a wrong-vintage bottle.
    const result = aggregatePriceData([
      makeRetailer({ slug: 'a', price: 40, vintage_mismatch: true }),
      makeRetailer({ slug: 'b', price: 900, vintage_mismatch: true, non_standard_format: true }),
    ])
    expect(result.other_vintage_price_range).toEqual({ min: 40, max: 40 })
  })
})

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
