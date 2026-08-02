import fs from 'fs'
import path from 'path'
import { fetchReviewData } from './index'
import type { WineEntry } from '@shared/types'
import { isRelevantMatch, findProductPage } from './find-product-page'
import type { RetailerConfig } from '@shared/config/retailers.config'
import { extractCandidateText } from './keyword-window'
import { canonicalizePublication } from './gpt-extract'

// ─── Puppeteer mock ──────────────────────────────────────────────────────────
jest.mock('./puppeteer-extract', () => ({
  renderPageHtml: jest.fn(),
}))
import { renderPageHtml } from './puppeteer-extract'
const mockRenderPageHtml = renderPageHtml as jest.MockedFunction<typeof renderPageHtml>

// ─── GPT-4o extraction mock ───────────────────────────────────────────────────
jest.mock('./gpt-extract', () => {
  const actual = jest.requireActual('./gpt-extract')
  return {
    ...actual,
    extractFromRenderedHtml: jest.fn(),
  }
})
import { extractFromRenderedHtml } from './gpt-extract'
const mockExtract = extractFromRenderedHtml as jest.MockedFunction<typeof extractFromRenderedHtml>

// ─── Serper organic search mock ───────────────────────────────────────────────
// Keyed by a substring of the query (site:<domain>) so each retailer's
// request can be controlled independently.
let mockOrganicByDomain: Record<string, Array<{ title: string; link: string; snippet?: string }>> = {}

const originalFetch = global.fetch
const originalEnv = process.env

beforeEach(() => {
  process.env = { ...originalEnv, SERPER_API_KEY: 'test-serper-key', OPENAI_API_KEY: 'test-openai-key' }
  jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    const body = JSON.parse(String(init?.body)) as { q: string }
    const domain = Object.keys(mockOrganicByDomain).find(d => body.q.includes(`site:${d}`))
    const organic = domain ? mockOrganicByDomain[domain] : []
    return Promise.resolve(
      new Response(JSON.stringify({ organic }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = originalEnv
  jest.clearAllMocks()
  mockOrganicByDomain = {}
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeWine(overrides: Partial<WineEntry> = {}): WineEntry {
  return {
    id: 'wine-1',
    producer: 'Domaine Rousseau',
    vintage: 2019,
    region: 'Burgundy',
    denomination: 'Gevrey-Chambertin',
    grape_varieties: ['Pinot Noir'],
    quality_classification: null,
    vineyard: null,
    cuvee: null,
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
    review_data: null,
    date_added: '2024-01-01T00:00:00.000Z',
    date_first_consumed: null,
    ...overrides,
  }
}

function readFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8')
}

describe('isRelevantMatch', () => {
  it('matches when text contains both producer and denomination words', () => {
    expect(
      isRelevantMatch('Domaine Rousseau Gevrey-Chambertin 2019 | K&L Wines', {
        producer: 'Domaine Rousseau',
        denomination: 'Gevrey-Chambertin',
        vintage: 2019,
      })
    ).toBe(true)
  })

  it('rejects when neither producer nor denomination words appear in the text', () => {
    expect(
      isRelevantMatch('Cabernet Sauvignon Reserve 2019 | Random Winery', {
        producer: 'Domaine Rousseau',
        denomination: 'Gevrey-Chambertin',
        vintage: 2019,
      })
    ).toBe(false)
  })
})

// ─── findProductPage: relaxed-query retry (2026-08-02 fix) ─────────────────
// Diagnosed against a real user report: Woodland Hills carries a Fèvre
// Chablis 1er Cru "Montée de Tonnerre" with real critic reviews, but the
// fully-qualified quoted-phrase query (producer + denomination + vineyard +
// vintage, all ANDed) came back with zero organic results — the retailer's
// own page text didn't literally contain every quoted phrase exactly as
// stored on the wine entry. These tests drive findProductPage directly
// (rather than through fetchReviewData) to control the Serper mock per call.
describe('findProductPage — relaxed-query retry', () => {
  const woodland: RetailerConfig = {
    slug: 'woodland',
    name: 'Woodland Hills Wine Co.',
    domain: 'whwc.com',
    matchKeyword: 'woodland',
    lat: 34.1684,
    lng: -118.6059,
  }

  const fevre = {
    producer: 'William Fèvre',
    denomination: 'Chablis 1er Cru',
    vintage: 2019,
    cuvee: null,
    vineyard: 'Montée de Tonnerre',
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('retries with cuvee/vineyard dropped when the full query returns zero results, and returns the match found on retry', async () => {
    const queries: string[] = []
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { q: string }
      queries.push(body.q)
      // First call (full query, includes "Montée de Tonnerre") — zero results,
      // because the AND-ed quoted phrase was too strict for Google's own
      // indexing of this page. Second call (vineyard dropped from the query)
      // — the real product page comes back; its title still naturally
      // contains the vineyard name (it's the actual product), so the
      // post-fetch relevance check (which still requires it) correctly
      // confirms this is the right page.
      const organic = queries.length === 1
        ? []
        : [{ title: 'William Fevre Chablis 1er Cru Montee de Tonnerre 2019 | Woodland Hills', link: 'https://whwc.com/fevre-chablis-1er-cru-montee-de-tonnerre-2019/' }]
      return Promise.resolve(
        new Response(JSON.stringify({ organic }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })

    const result = await findProductPage(fevre, woodland, 'test-key')

    expect(result).toBe('https://whwc.com/fevre-chablis-1er-cru-montee-de-tonnerre-2019/')
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain('Montee de Tonnerre') // diacritic-folded, but still present
    expect(queries[1]).not.toContain('Tonnerre') // vineyard dropped on retry
  })

  it('falls all the way back to producer+denomination only when every narrower variant is also empty', async () => {
    const queries: string[] = []
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { q: string }
      queries.push(body.q)
      const organic = queries.length === 3
        ? [{ title: 'William Fevre Chablis 1er Cru Montee de Tonnerre | Woodland Hills', link: 'https://whwc.com/fevre-chablis-1er-cru/' }]
        : []
      return Promise.resolve(
        new Response(JSON.stringify({ organic }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })

    const result = await findProductPage(fevre, woodland, 'test-key')

    expect(result).toBe('https://whwc.com/fevre-chablis-1er-cru/')
    expect(queries).toHaveLength(3)
    expect(queries[2]).not.toContain('2019') // vintage dropped on the final retry
  })

  it('does not retry when a variant returns results but none are relevant — avoids matching the wrong product', async () => {
    let calls = 0
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      calls += 1
      return Promise.resolve(
        new Response(
          JSON.stringify({ organic: [{ title: 'Unrelated Cabernet from a different producer', link: 'https://whwc.com/x' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    })

    const result = await findProductPage(fevre, woodland, 'test-key')

    expect(result).toBeNull()
    expect(calls).toBe(1)
  })

  it('folds diacritics out of the query text even on the first, fully-qualified attempt', async () => {
    let firstQuery = ''
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const q = JSON.parse(String(init?.body)).q
      if (!firstQuery) firstQuery = q
      return Promise.resolve(new Response(JSON.stringify({ organic: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    await findProductPage(fevre, woodland, 'test-key')

    expect(firstQuery).toContain('Fevre')
    expect(firstQuery).not.toContain('Fèvre')
    expect(firstQuery).toContain('Montee de Tonnerre')
  })

  it('produces a single query variant (no retry) for a wine with no cuvee/vineyard/vintage', async () => {
    let calls = 0
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      calls += 1
      return Promise.resolve(new Response(JSON.stringify({ organic: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    await findProductPage(
      { producer: 'Roumier', denomination: 'Chambolle-Musigny', vintage: null, cuvee: null, vineyard: null },
      woodland,
      'test-key'
    )

    expect(calls).toBe(1)
  })
})

describe('extractCandidateText (keyword-window)', () => {
  it('matches "number + scoring word" ordering (e.g. "96 points")', () => {
    const html = `<p>filler text before. Rated 96 Points by our panel. filler text after.</p>`
    const result = extractCandidateText(html)
    expect(result).toContain('96 Points')
  })

  it('matches "scoring word + number" ordering (e.g. "Points: 96")', () => {
    const html = `<p>filler text. Score: 96. more filler.</p>`
    const result = extractCandidateText(html)
    expect(result).toContain('Score: 96')
  })

  it('matches range and plus forms ("94-96", "94+")', () => {
    expect(extractCandidateText('<p>A stunning wine, 94-96 points.</p>')).toContain('94-96 points')
    expect(extractCandidateText('<p>A stunning wine, 94+ points.</p>')).toContain('94+ points')
  })

  it('matches the compact badge form (title attribute + nearby bare number)', () => {
    const html = `<div title="Vinous"><span>V</span><span>96</span></div>`
    const result = extractCandidateText(html)
    expect(result).toContain('title="Vinous"')
    expect(result).toContain('96')
  })

  it('captures a citation for a publication not in CRITIC_KEYWORDS at all — capture is not gated on the known list', () => {
    const html = `<p>A regional guide review: 93 points from Some Regional Guide Nobody Has Configured Yet.</p>`
    const result = extractCandidateText(html)
    expect(result).toContain('93 points')
    expect(result).toContain('Some Regional Guide Nobody Has Configured Yet')
  })

  it('excludes Tailwind-style hyphenated CSS class numbers from the badge-form pattern', () => {
    // No real score badge here — just a title attribute followed by
    // class-name noise containing 2-3 digit numbers ("gray-500", "gray-100").
    // If those numbers incorrectly matched as a score citation, the result
    // would be a small ~1200-char window around just that div. Padding far
    // on both sides and asserting both survive proves the fallback (whole
    // stripped page) was used instead — i.e. no false match occurred.
    const filler = 'Lorem ipsum filler text. '.repeat(50)
    const html = `<p>START-${filler}</p><div title="Add to cart" class="text-gray-500 px-2 bg-gray-100">Add to cart</div><p>${filler}END</p>`
    const result = extractCandidateText(html)
    expect(result).toContain('START-')
    expect(result).toContain('END')
  })

  it('merges overlapping/nearby windows rather than duplicating them', () => {
    const html = `<p>Wine Advocate 96 points, also cited by Vinous at 95 points nearby.</p>`
    const result = extractCandidateText(html)
    // Both citations are close enough together that they should end up in
    // one merged window, not two separate "...".join()-ed pieces.
    expect(result).toContain('Wine Advocate 96 points')
    expect(result).toContain('Vinous at 95 points')
    expect(result.split('\n...\n').length).toBe(1)
  })

  it('falls back to stripped, capped text when no score-citation pattern is found', () => {
    const html = `<html><body><p>No scores here, just a product description.</p></body></html>`
    const result = extractCandidateText(html)
    expect(result).toContain('No scores here')
  })

  it('strips script/style/svg tags and HTML comments before searching', () => {
    const html = `<script>var junk = "96 points but this is fake, inside a script tag";</script><style>.x{content:"97 points fake css"}</style><svg><text>98 points fake svg</text></svg><!-- 99 points fake comment --><p>Real content, no score here.</p>`
    const result = extractCandidateText(html)
    expect(result).not.toContain('fake')
  })
})

describe('canonicalizePublication', () => {
  it('normalizes an exact known publication name', () => {
    expect(canonicalizePublication('Wine Advocate')).toEqual({ publication: 'Wine Advocate', known_publication: true })
  })

  it('normalizes a known critic surname to their publication', () => {
    expect(canonicalizePublication('Kelley')).toEqual({ publication: 'Wine Advocate', known_publication: true })
  })

  it('normalizes a known abbreviation', () => {
    expect(canonicalizePublication('WA')).toEqual({ publication: 'Wine Advocate', known_publication: true })
  })

  it('matches a surname embedded in a longer attribution string', () => {
    expect(canonicalizePublication("Robert Parker's Wine Advocate: Joe Czerwinski")).toEqual({
      publication: 'Wine Advocate',
      known_publication: true,
    })
  })

  it('keeps unrecognized attribution text as-is and flags known_publication false', () => {
    expect(canonicalizePublication('Some Regional Guide Nobody Has Configured Yet')).toEqual({
      publication: 'Some Regional Guide Nobody Has Configured Yet',
      known_publication: false,
    })
  })
})

describe('fetchReviewData', () => {
  it('returns an empty array when SERPER_API_KEY is not configured', async () => {
    delete process.env.SERPER_API_KEY
    expect(await fetchReviewData(makeWine())).toEqual([])
  })

  it('returns an empty array when OPENAI_API_KEY is not configured', async () => {
    delete process.env.OPENAI_API_KEY
    expect(await fetchReviewData(makeWine())).toEqual([])
  })

  it('returns an empty array when producer and denomination are both missing', async () => {
    expect(await fetchReviewData(makeWine({ producer: null, denomination: null }))).toEqual([])
  })

  it('finds a product page, renders it, extracts scores, and populates review_data for the matching retailer only', async () => {
    mockOrganicByDomain = {
      'klwines.com': [
        {
          title: 'Domaine Rousseau Gevrey-Chambertin 2019 | K&L Wines',
          link: 'https://shop.klwines.com/products/details/1557135',
          snippet: 'Buy Domaine Rousseau Gevrey-Chambertin 2019',
        },
      ],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered product page</html>')
    mockExtract.mockResolvedValue({
      price: 1200,
      url: 'https://shop.klwines.com/products/details/1557135',
      vintage: 2019,
      critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    const result = await fetchReviewData(makeWine())

    expect(result).toEqual([
      {
        slug: 'kl',
        name: 'K&L Wine Merchants',
        product_url: 'https://shop.klwines.com/products/details/1557135',
        critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
        fetched_at: expect.any(String),
        source: 'configured',
      },
    ])
    expect(mockRenderPageHtml).toHaveBeenCalledWith('https://shop.klwines.com/products/details/1557135')
  })

  it('skips a retailer with no relevant organic result, without failing the others', async () => {
    mockOrganicByDomain = {
      'klwines.com': [{ title: 'Unrelated Cabernet from a different producer', link: 'https://shop.klwines.com/x' }],
      'zachys.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.zachys.com/p/1' }],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({ price: null, url: 'https://www.zachys.com/p/1', vintage: null, critic_scores: [] })

    const result = await fetchReviewData(makeWine())

    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('zachys')
  })

  it('skips a retailer whose product page render times out', async () => {
    mockOrganicByDomain = {
      'klwines.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://shop.klwines.com/p/1' }],
    }
    mockRenderPageHtml.mockResolvedValue(null)

    expect(await fetchReviewData(makeWine())).toEqual([])
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it('skips a retailer when GPT-4o extraction fails', async () => {
    mockOrganicByDomain = {
      'klwines.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://shop.klwines.com/p/1' }],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue(null)

    expect(await fetchReviewData(makeWine())).toEqual([])
  })

  it('includes a retailer with a successful extraction even when no attributed score was found', async () => {
    mockOrganicByDomain = {
      'klwines.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://shop.klwines.com/p/1' }],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({ price: 1200, url: 'https://shop.klwines.com/p/1', vintage: 2019, critic_scores: [] })

    const result = await fetchReviewData(makeWine())

    expect(result).toHaveLength(1)
    expect(result[0].critic_scores).toEqual([])
  })
})

// ─── Open-web fallback pass (Phase 7.3, 2026-08-02) ────────────────────────
// Specced 2026-07-29 (docs/build-phases.md Phase 7.3) alongside the retailer
// list expansion, but never actually wired into find-product-page.ts/index.ts
// until now — the docs described it as shipped, the code didn't have it.
// Mirrors the price module's Pass 1 (preferred) / Pass 2 (open fallback)
// pattern. installSerperMock below handles both query shapes: a
// site:-restricted query (configured-retailer Step 1) and a plain query with
// no site: token (the fallback pass) — distinguished the same way
// find-product-page.ts's real queries are.
describe('fetchReviewData — open-web fallback pass', () => {
  function installSerperMock(
    byDomain: Record<string, Array<{ title: string; link: string; snippet?: string }>>,
    openQueryResults: Array<{ title: string; link: string; snippet?: string }> = []
  ): string[] {
    const queries: string[] = []
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { q: string }
      queries.push(body.q)
      const domain = Object.keys(byDomain).find(d => body.q.includes(`site:${d}`))
      const organic = domain ? byDomain[domain] : body.q.includes('site:') ? [] : openQueryResults
      return Promise.resolve(
        new Response(JSON.stringify({ organic }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })
    return queries
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('does not run the fallback pass when a configured retailer already returned a critic score', async () => {
    const queries = installSerperMock(
      { 'klwines.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://shop.klwines.com/p/1' }] },
      [{ title: 'Should never be reached', link: 'https://someblog.com/review' }]
    )
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: 1200,
      url: 'https://shop.klwines.com/p/1',
      vintage: 2019,
      critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    const result = await fetchReviewData(makeWine())

    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('configured')
    // No query without a site: token was ever sent — the fallback never ran.
    expect(queries.some(q => !q.includes('site:'))).toBe(false)
  })

  it('populates review_data via the fallback when every configured retailer returns nothing, tagged source: fallback', async () => {
    const queries = installSerperMock(
      {}, // every configured retailer's site:-restricted query comes back empty
      [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019 | AmsterWine', link: 'https://www.amsterwine.com/p/1' }]
    )
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: null,
      url: 'https://www.amsterwine.com/p/1',
      vintage: null,
      critic_scores: [{ publication: 'Vinous', score: 93, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    const result = await fetchReviewData(makeWine())

    expect(result).toEqual([
      {
        slug: 'fallback-amsterwine-com',
        name: 'amsterwine.com',
        product_url: 'https://www.amsterwine.com/p/1',
        critic_scores: [{ publication: 'Vinous', score: 93, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
        fetched_at: expect.any(String),
        source: 'fallback',
      },
    ])
    expect(mockRenderPageHtml).toHaveBeenCalledWith('https://www.amsterwine.com/p/1')
    expect(queries.some(q => !q.includes('site:') && q.includes('review'))).toBe(true)
  })

  it('excludes CellarTracker and WineBerserkers from fallback candidates even when Serper returns them', async () => {
    installSerperMock(
      {},
      [
        { title: 'Domaine Rousseau Gevrey-Chambertin 2019 Community Notes', link: 'https://www.cellartracker.com/notes/12345' },
        { title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.wineberserkers.com/viewtopic.php?t=1' },
        { title: 'Domaine Rousseau Gevrey-Chambertin 2019 | AmsterWine', link: 'https://www.amsterwine.com/p/1' },
      ]
    )
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: null,
      url: 'https://www.amsterwine.com/p/1',
      vintage: null,
      critic_scores: [{ publication: 'Vinous', score: 93, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    const result = await fetchReviewData(makeWine())

    expect(result).toHaveLength(1)
    expect(result[0].product_url).toBe('https://www.amsterwine.com/p/1')
    expect(mockRenderPageHtml).not.toHaveBeenCalledWith(expect.stringContaining('cellartracker'))
    expect(mockRenderPageHtml).not.toHaveBeenCalledWith(expect.stringContaining('wineberserkers'))
  })

  it('returns an empty array when the fallback pass also finds nothing', async () => {
    installSerperMock({}, [])

    expect(await fetchReviewData(makeWine())).toEqual([])
  })
})

// ─── Regression fixtures ───────────────────────────────────────────────────────
// Three real rendered pages captured during the 2026-07-24 live test that
// diagnosed the original 80K blind-truncation bug. Used directly as
// known-good/known-bad cases rather than synthesized HTML, since they
// already demonstrate the failure this rework fixes.
describe('extractCandidateText — regression fixtures', () => {
  it('K&L: a bot-detection stub page yields no meaningful content (known-bad case)', () => {
    const html = readFixture('kl-product-page-bot-block.html')
    const result = extractCandidateText(html)
    expect(result.toLowerCase()).not.toContain('advocate')
    expect(result.toLowerCase()).not.toContain('vinous')
  })

  it('Zachys: a real 879K-char product page — the review section (offset 384,907, far past the old 80K cutoff) is captured', () => {
    const html = readFixture('zachys-clos-des-papes-2020.html')
    const result = extractCandidateText(html)
    expect(result.toLowerCase()).toContain('advocate')
    expect(result).toContain('96+ Points')
    // The whole point of windowing: send far less than the full page.
    expect(result.length).toBeLessThan(html.length / 10)
  })

  it('Benchmark: a real 189K-char product page — badge-form scores (title attribute + bare number) are captured', () => {
    const html = readFixture('benchmark-clos-des-papes-2020.html')
    const result = extractCandidateText(html)
    expect(result).toContain('title="Vinous"')
    expect(result).toContain('title="The Wine Advocate"')
    expect(result).toContain('title="Decanter"')
  })
})
