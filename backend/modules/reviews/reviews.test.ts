import fs from 'fs'
import path from 'path'
import { fetchReviewData } from './index'
import type { WineEntry } from '@shared/types'
import {
  isRelevantMatch,
  findProductPage,
  findProductPageDetailed,
  findFallbackProductPage,
  isUnrenderableDomain,
} from './find-product-page'
import { RETAILER_CONFIG, type RetailerConfig } from '@shared/config/retailers.config'
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

// ─── Graded candidate selection (Phase 9.1, WI-1) ──────────────────────────
// Step 1 used to take `items.find(isRelevantMatch)` — whichever result Serper
// happened to rank first among those passing a boolean check. It now scores
// every organic result, keeps the acceptable ones, and sorts them by match
// quality, so the exact vintage wins when a shop indexes several. See
// docs/specs/2026-08-04-phase-9.1-identity-matching-remediation.md WI-1.
describe('findProductPageDetailed — graded candidate selection', () => {
  const woodland: RetailerConfig = {
    slug: 'woodland',
    name: 'Woodland Hills Wine Co.',
    domain: 'whwc.com',
    matchKeyword: 'woodland',
    reviewTier: 'primary',
    lat: 34.1684,
    lng: -118.6059,
  }

  const audoin = {
    producer: 'Domaine Charles Audoin',
    denomination: 'Marsannay',
    vintage: 2022,
    cuvee: null,
    vineyard: null,
  }

  function mockOrganic(items: Array<{ title: string; link: string; snippet?: string }>) {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ organic: items }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('picks the exact vintage over a near one, regardless of Serper ranking', async () => {
    // Serper ranks the 2020 first; the 2022 is the wine actually asked for.
    mockOrganic([
      { title: 'Charles Audoin Marsannay Clos du Roy 2020', link: 'https://whwc.com/audoin-2020/' },
      { title: 'Charles Audoin Marsannay Clos du Roy 2022', link: 'https://whwc.com/audoin-2022/' },
    ])

    const outcome = await findProductPageDetailed(audoin, woodland, 'test-key')

    expect(outcome.url).toBe('https://whwc.com/audoin-2022/')
    expect(outcome.stage).toBe('found')
    expect(outcome.match?.vintage).toBe('match')
    expect(outcome.match?.vintageGap).toBe(0)
  })

  it('still returns a wrong-vintage page when it is the only one, with the gap recorded', async () => {
    // Benchmark's only Charles Audoin page is the 2020. Vintage ranks and
    // labels — it never rejects.
    mockOrganic([
      { title: 'Charles Audoin Marsannay Clos du Roy 2020', link: 'https://whwc.com/audoin-2020/' },
    ])

    const outcome = await findProductPageDetailed(audoin, woodland, 'test-key')

    expect(outcome.url).toBe('https://whwc.com/audoin-2020/')
    expect(outcome.match?.vintage).toBe('mismatch')
    expect(outcome.match?.vintageGap).toBe(2)
  })

  it('rejects a sister-estate page that only name-drops the producer in its snippet', async () => {
    // THE regression case: nine Chateau Lafleur scores were stored against
    // Chateau Grand Village because the Lafleur page's body copy mentions the
    // sister estate. Producer is judged on title + URL only.
    mockOrganic([
      {
        title: 'Chateau Lafleur Pomerol 2016',
        link: 'https://whwc.com/lafleur-pomerol-2016/',
        snippet: 'The Guinaudeau family, also behind Chateau Grand Village, produce this Pomerol...',
      },
    ])

    const outcome = await findProductPageDetailed(
      { producer: 'Grand Village', denomination: 'Vin de France', vintage: 2022, cuvee: null, vineyard: null },
      woodland,
      'test-key'
    )

    expect(outcome.url).toBeNull()
    expect(outcome.stage).toBe('no_relevant_match')
    expect(outcome.match).toBeNull()
  })

  it('returns the verdict the winning candidate was accepted on', async () => {
    mockOrganic([
      { title: 'Charles Audoin Marsannay 2022', link: 'https://whwc.com/audoin-2022/' },
    ])

    const outcome = await findProductPageDetailed(audoin, woodland, 'test-key')

    expect(outcome.match).toEqual({
      producer: 'match',
      denomination: 'match',
      bottling: 'unknown',
      vintage: 'match',
      candidateVintage: 2022,
      vintageGap: 0,
    })
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
    reviewTier: 'primary',
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

  // ─── Producer relaxation (Phase 9.1, WI-5) ──────────────────────────────
  // The price module found Morrell's Jean-Marc Vincent listing (correct 2022
  // vintage, $135) in the same run this module found nothing there. The
  // difference: price's query is unquoted and relevance-ranked, while this
  // one demanded the literal phrase "Domaine Jean-Marc Vincent" — a word
  // Morrell's own title never contains. 7 of the 14 batch wines begin with
  // "Domaine".
  it('retries without the Domaine honorific when the fully-qualified query is empty', async () => {
    const morrell: RetailerConfig = {
      slug: 'morrell',
      name: 'Morrell & Company',
      domain: 'morrellwine.com',
      matchKeyword: 'morrell',
    reviewTier: 'primary',
      lat: 40.7587,
      lng: -73.9787,
    }
    const queries: string[] = []
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { q: string }
      queries.push(body.q)
      // Only the honorific-stripped query finds Morrell's actual listing.
      const organic = body.q.includes('"Domaine Jean-Marc Vincent"')
        ? []
        : [{
            title: 'Jean-Marc Vincent Santenay Rouge 1er Cru Gravieres 2022',
            link: 'https://www.morrellwine.com/products/jean-marc-vincent-santenay-gravieres-2022',
          }]
      return Promise.resolve(
        new Response(JSON.stringify({ organic }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })

    const result = await findProductPage(
      { producer: 'Domaine Jean-Marc Vincent', denomination: 'Santenay', vintage: 2022, cuvee: null, vineyard: null },
      morrell,
      'test-key'
    )

    expect(result).toBe('https://www.morrellwine.com/products/jean-marc-vincent-santenay-gravieres-2022')
    expect(queries[0]).toContain('"Domaine Jean-Marc Vincent"')
    // The relaxation comes second — before dropping the vintage, which is a
    // real identity constraint rather than a word the shop never wrote.
    expect(queries[1]).toContain('"Jean-Marc Vincent"')
    expect(queries[1]).not.toContain('Domaine')
    expect(queries[1]).toContain('2022')
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
    expect(result!.split('\n...\n').length).toBe(1)
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
  // Null, not [] (2026-08-05): a missing key means the search could not be
  // run, which is not the same as running it and finding nothing. The route
  // writes nothing on null — otherwise a misconfigured environment silently
  // erases every wine's review_data on the next refresh.
  it('returns null — not an empty array — when SERPER_API_KEY is not configured', async () => {
    delete process.env.SERPER_API_KEY
    expect(await fetchReviewData(makeWine())).toBeNull()
  })

  it('returns null when OPENAI_API_KEY is not configured', async () => {
    delete process.env.OPENAI_API_KEY
    expect(await fetchReviewData(makeWine())).toBeNull()
  })

  it('returns null when every Serper request fails, rather than reporting nothing found', async () => {
    // The 2026-08-05 data loss: Serper ran out of credits mid-batch and
    // answered every query with HTTP 400 in milliseconds. Each wine's
    // review_data was then overwritten with [].
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('{"message":"Not enough credits"}', { status: 400 }))
    )

    expect(await fetchReviewData(makeWine())).toBeNull()
  })

  it('returns an empty array when producer and denomination are both missing', async () => {
    expect(await fetchReviewData(makeWine({ producer: null, denomination: null }))).toEqual([])
  })

  it('finds a product page, renders it, extracts scores, and populates review_data for the matching retailer only', async () => {
    mockOrganicByDomain = {
      'benchmarkwine.com': [
        {
          title: 'Domaine Rousseau Gevrey-Chambertin 2019 | Benchmark Wine Group',
          link: 'https://www.benchmarkwine.com/products/details/1557135',
          snippet: 'Buy Domaine Rousseau Gevrey-Chambertin 2019',
        },
      ],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered product page</html>')
    mockExtract.mockResolvedValue({
      price: 1200,
      url: 'https://www.benchmarkwine.com/products/details/1557135',
      vintage: 2019,
      critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    const result = await fetchReviewData(makeWine())

    expect(result).toEqual([
      {
        slug: 'benchmark',
        name: 'Benchmark Wine Group',
        product_url: 'https://www.benchmarkwine.com/products/details/1557135',
        critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
        fetched_at: expect.any(String),
        source: 'configured',
        page_vintage: 2019,
        vintage_gap: 0,
        match: {
          producer: 'match',
          denomination: 'match',
          bottling: 'unknown',
          vintage: 'match',
          candidateVintage: 2019,
          vintageGap: 0,
        },
        page_price: 1200,
      },
    ])
    expect(mockRenderPageHtml).toHaveBeenCalledWith('https://www.benchmarkwine.com/products/details/1557135')
  })

  it('skips a retailer with no relevant organic result, without failing the others', async () => {
    mockOrganicByDomain = {
      'benchmarkwine.com': [{ title: 'Unrelated Cabernet from a different producer', link: 'https://www.benchmarkwine.com/x' }],
      'zachys.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.zachys.com/p/1' }],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({ price: null, url: 'https://www.zachys.com/p/1', vintage: null, critic_scores: [] })

    const result = await fetchReviewData(makeWine())

    expect(result).toHaveLength(1)
    expect(result![0].slug).toBe('zachys')
  })

  it('skips a retailer whose product page render times out', async () => {
    mockOrganicByDomain = {
      'benchmarkwine.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.benchmarkwine.com/p/1' }],
    }
    mockRenderPageHtml.mockResolvedValue(null)

    expect(await fetchReviewData(makeWine())).toEqual([])
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it('skips a retailer when GPT-4o extraction fails', async () => {
    mockOrganicByDomain = {
      'benchmarkwine.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.benchmarkwine.com/p/1' }],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue(null)

    expect(await fetchReviewData(makeWine())).toEqual([])
  })

  it('includes a retailer with a successful extraction even when no attributed score was found', async () => {
    mockOrganicByDomain = {
      'benchmarkwine.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.benchmarkwine.com/p/1' }],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({ price: 1200, url: 'https://www.benchmarkwine.com/p/1', vintage: 2019, critic_scores: [] })

    const result = await fetchReviewData(makeWine())

    expect(result).toHaveLength(1)
    expect(result![0].critic_scores).toEqual([])
  })
})

// ─── Unrenderable domains (Phase 9.2, WI-2) ────────────────────────────────
// UNRENDERABLE_DOMAINS existed since Phase 9.1 but was consulted only in the
// fallback passes, so the configured loop still burned a full variant ladder
// on K&L for every wine before a render that has been bot-blocked since
// Phase 7. Guaranteed empty, and paid for on every run since the feature
// shipped.
describe('fetchReviewData — domains that cannot be rendered', () => {
  it('issues no site:-scoped query against a domain whose pages can never be read', async () => {
    const queries: string[] = []
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      queries.push((JSON.parse(String(init?.body)) as { q: string }).q)
      return Promise.resolve(
        new Response(JSON.stringify({ organic: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })

    await fetchReviewData(makeWine())

    expect(queries.some(q => q.includes('site:klwines.com'))).toBe(false)
    // The rest of the configured list is still searched — this is a skip, not
    // a shrunken retailer list (see the spec's §2, RETAILER_CONFIG is not
    // shrinking).
    expect(queries.some(q => q.includes('site:benchmarkwine.com'))).toBe(true)
  })

  // The two mechanisms are deliberately separate: renderability is a
  // technical fact about the page, reviewTier is a product judgement about
  // cost. K&L is a primary retailer that happens to be unreadable, and the
  // skip must not read as a demotion.
  it('keeps the unreadable retailer configured, so the fallback passes still know it was hopeless', async () => {
    expect(RETAILER_CONFIG.some(r => r.slug === 'kl')).toBe(true)
    expect(isUnrenderableDomain('shop.klwines.com')).toBe(true)
    expect(isUnrenderableDomain('benchmarkwine.com')).toBe(false)
  })
})

// ─── Primary / extended tiers (Phase 9.2, WI-3) ────────────────────────────
// RETAILER_CONFIG grew 4 → 11 → 12 without the per-wine query cost being
// revisited, and every entry was searched for every wine. Coverage is not
// shrinking; what changes is *when* a retailer is searched. An extended
// retailer is fully trusted, just not paid for up front.
describe('fetchReviewData — primary and extended review tiers', () => {
  function recordQueries(byDomain: Record<string, Array<{ title: string; link: string }>>): string[] {
    const queries: string[] = []
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const q = (JSON.parse(String(init?.body)) as { q: string }).q
      queries.push(q)
      const domain = Object.keys(byDomain).find(d => q.includes(`site:${d}`))
      return Promise.resolve(
        new Response(JSON.stringify({ organic: domain ? byDomain[domain] : [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })
    return queries
  }

  const primarySlugs = RETAILER_CONFIG.filter(r => r.reviewTier === 'primary').map(r => r.slug)
  const extendedSlugs = RETAILER_CONFIG.filter(r => r.reviewTier === 'extended').map(r => r.slug)

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('never pays for an extended retailer once the primary tier has produced a score', async () => {
    const queries = recordQueries({
      'benchmarkwine.com': [
        { title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.benchmarkwine.com/p/1' },
      ],
    })
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: 1200,
      url: 'https://www.benchmarkwine.com/p/1',
      vintage: 2019,
      critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    const result = await fetchReviewData(makeWine())

    expect(result).toHaveLength(1)
    expect(queries.some(q => q.includes('site:sokolin.com'))).toBe(false)
    for (const slug of extendedSlugs) {
      const domain = RETAILER_CONFIG.find(r => r.slug === slug)!.domain
      expect(queries.some(q => q.includes(`site:${domain}`))).toBe(false)
    }
  })

  // The escalation gate is the same predicate the discovered-merchant and
  // open-web passes already used — a page that rendered but cited no score
  // counts as nothing found.
  it('escalates to the extended tier when the primary tier renders pages but finds no score', async () => {
    const queries = recordQueries({
      'benchmarkwine.com': [
        { title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.benchmarkwine.com/p/1' },
      ],
    })
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: 1200,
      url: 'https://www.benchmarkwine.com/p/1',
      vintage: 2019,
      critic_scores: [],
    })

    await fetchReviewData(makeWine())

    expect(queries.some(q => q.includes('site:sokolin.com'))).toBe(true)
  })

  it('searches every configured retailer except the unrenderable ones when the primary tier finds nothing', async () => {
    const queries = recordQueries({})

    await fetchReviewData(makeWine())

    for (const retailer of RETAILER_CONFIG) {
      const searched = queries.some(q => q.includes(`site:${retailer.domain}`))
      expect({ slug: retailer.slug, searched }).toEqual({
        slug: retailer.slug,
        searched: !isUnrenderableDomain(retailer.domain),
      })
    }
  })

  // Guards the seeding itself: a tier that emptied out would silently turn
  // this into either "search everything twice" or "search nothing".
  it('has retailers in both tiers', () => {
    expect(primarySlugs.length).toBeGreaterThan(0)
    expect(extendedSlugs.length).toBeGreaterThan(0)
    expect([...primarySlugs, ...extendedSlugs].sort()).toEqual(RETAILER_CONFIG.map(r => r.slug).sort())
  })
})

// ─── Negative probe memory (Phase 9.2, WI-5) ───────────────────────────────
// A retailer that returned zero_results for this bottling burns the full
// query-variant ladder every run to learn the same thing again. The one rule
// this whole section exists to protect: skip on zero_results only, and
// categorically never on request_failed — reading a transient failure as a
// negative is the exact conflation that erased eight wines' review_data on
// 2026-08-05.
describe('fetchReviewData — probe log (existingProbeLog / probeLogSink)', () => {
  function recordQueries(): string[] {
    const queries: string[] = []
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      queries.push((JSON.parse(String(init?.body)) as { q: string }).q)
      return Promise.resolve(
        new Response(JSON.stringify({ organic: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })
    return queries
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('issues no query for a retailer whose last probe was a fresh zero_results', async () => {
    const queries = recordQueries()
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()

    await fetchReviewData(makeWine(), {
      existingProbeLog: [
        { slug: 'benchmark', domain: 'benchmarkwine.com', stage: 'zero_results', variants_tried: 3, probed_at: tenDaysAgo },
      ],
    })

    expect(queries.some(q => q.includes('site:benchmarkwine.com'))).toBe(false)
    // The rest of the primary tier is still searched — this is a per-retailer
    // skip, not a shrunken list.
    expect(queries.some(q => q.includes('site:whwc.com'))).toBe(true)
  })

  // The load-bearing case: a transient failure must re-query on the very next
  // run, no matter how it's stored.
  it('re-queries a retailer whose last probe was request_failed, even if very recent', async () => {
    const queries = recordQueries()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    await fetchReviewData(makeWine(), {
      existingProbeLog: [
        { slug: 'benchmark', domain: 'benchmarkwine.com', stage: 'request_failed', variants_tried: 0, probed_at: oneHourAgo },
      ],
    })

    expect(queries.some(q => q.includes('site:benchmarkwine.com'))).toBe(true)
  })

  it('re-queries a retailer whose last probe was no_relevant_match', async () => {
    const queries = recordQueries()

    await fetchReviewData(makeWine(), {
      existingProbeLog: [
        { slug: 'benchmark', domain: 'benchmarkwine.com', stage: 'no_relevant_match', variants_tried: 2, probed_at: new Date().toISOString() },
      ],
    })

    expect(queries.some(q => q.includes('site:benchmarkwine.com'))).toBe(true)
  })

  it('re-queries once a zero_results probe has aged past the TTL', async () => {
    const queries = recordQueries()
    const veryOld = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()

    await fetchReviewData(makeWine(), {
      existingProbeLog: [
        { slug: 'benchmark', domain: 'benchmarkwine.com', stage: 'zero_results', variants_tried: 3, probed_at: veryOld },
      ],
    })

    expect(queries.some(q => q.includes('site:benchmarkwine.com'))).toBe(true)
  })

  it('writes one probe entry per retailer actually queried in the configured passes', async () => {
    recordQueries()
    const sink: Array<{ slug: string; stage: string }> = []

    await fetchReviewData(makeWine(), { probeLogSink: sink as never })

    const primaryAndExtendedSlugs = RETAILER_CONFIG
      .filter(r => !isUnrenderableDomain(r.domain))
      .map(r => r.slug)
    expect(sink.map(e => e.slug).sort()).toEqual(primaryAndExtendedSlugs.sort())
    expect(sink.every(e => e.stage === 'zero_results')).toBe(true)
  })

  it('does not write a probe entry for a retailer this run skipped on a fresh negative', async () => {
    recordQueries()
    const sink: Array<{ slug: string }> = []
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()

    await fetchReviewData(makeWine(), {
      existingProbeLog: [
        { slug: 'benchmark', domain: 'benchmarkwine.com', stage: 'zero_results', variants_tried: 3, probed_at: tenDaysAgo },
      ],
      probeLogSink: sink as never,
    })

    expect(sink.some(e => e.slug === 'benchmark')).toBe(false)
  })

  it('does not write a probe entry for an unrenderable retailer', async () => {
    recordQueries()
    const sink: Array<{ slug: string }> = []

    await fetchReviewData(makeWine(), { probeLogSink: sink as never })

    expect(sink.some(e => e.slug === 'kl')).toBe(false)
  })

  it('does not write probe entries for an extended-tier retailer the primary tier already made unnecessary', async () => {
    const sink: Array<{ slug: string }> = []
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const q = (JSON.parse(String(init?.body)) as { q: string }).q
      const organic = q.includes('site:benchmarkwine.com')
        ? [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.benchmarkwine.com/p/1' }]
        : []
      return Promise.resolve(
        new Response(JSON.stringify({ organic }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: null,
      url: 'https://www.benchmarkwine.com/p/1',
      vintage: 2019,
      critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    await fetchReviewData(makeWine(), { probeLogSink: sink as never })

    expect(sink.some(e => e.slug === 'sokolin')).toBe(false)
  })
})

// ─── Page-stated vintage (Phase 9.1, WI-2) ─────────────────────────────────
// gpt-extract.ts has always returned { price, url, vintage, critic_scores }
// and fetchReviewData read only critic_scores, dropping the rest. The
// rendered page is evidence; the search-result title is a guess. The page's
// own vintage is now fed back through scoreMatch for a second, more
// authoritative verdict.
describe('fetchReviewData — page-stated vintage', () => {
  it('re-scores against the rendered page vintage and records the gap', async () => {
    // Benchmark's only Charles Audoin page is the 2020: the scores are real,
    // they just belong to a different year. Kept and labelled, not binned.
    mockOrganicByDomain = {
      'benchmarkwine.com': [
        {
          title: 'Charles Audoin Marsannay Clos du Roy',
          link: 'https://www.benchmarkwine.com/products/154340-charles-audoin-marsannay-clos-du-roy',
        },
      ],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: 65,
      url: 'https://www.benchmarkwine.com/products/154340-charles-audoin-marsannay-clos-du-roy',
      vintage: 2020,
      critic_scores: [
        { publication: 'Vinous', score: 91, known_publication: true, drinking_window: null, vintage_character: null, deal: false },
      ],
    })

    const result = await fetchReviewData(
      makeWine({ producer: 'Domaine Charles Audoin', denomination: 'Marsannay', vintage: 2022 })
    )

    expect(result).toHaveLength(1)
    expect(result![0].page_vintage).toBe(2020)
    expect(result![0].vintage_gap).toBe(2)
    expect(result![0].match.vintage).toBe('mismatch')
    // The scores themselves are never dropped — only excluded from
    // wine-level derivation (see derive-wine-level.ts).
    expect(result![0].critic_scores).toHaveLength(1)
  })

  it('lets the page vintage overturn a wrong year parsed from the search title', async () => {
    // The title carries "2020" from an unrelated vintage-report link; the
    // page itself states 2022. The rendered page wins.
    mockOrganicByDomain = {
      'benchmarkwine.com': [
        { title: 'Domaine Rousseau Gevrey-Chambertin — 2020 vintage report', link: 'https://www.benchmarkwine.com/p/1' },
      ],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: null,
      url: 'https://www.benchmarkwine.com/p/1',
      vintage: 2019,
      critic_scores: [],
    })

    const result = await fetchReviewData(makeWine())

    expect(result![0].page_vintage).toBe(2019)
    expect(result![0].vintage_gap).toBe(0)
    expect(result![0].match.vintage).toBe('match')
  })

  it('falls back to the search-result verdict when the page states no vintage', async () => {
    mockOrganicByDomain = {
      'benchmarkwine.com': [
        { title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.benchmarkwine.com/p/1' },
      ],
    }
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({ price: null, url: 'https://www.benchmarkwine.com/p/1', vintage: null, critic_scores: [] })

    const result = await fetchReviewData(makeWine())

    expect(result![0].page_vintage).toBe(2019)
    expect(result![0].match.vintage).toBe('match')
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
      { 'benchmarkwine.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.benchmarkwine.com/p/1' }] },
      [{ title: 'Should never be reached', link: 'https://someblog.com/review' }]
    )
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: 1200,
      url: 'https://www.benchmarkwine.com/p/1',
      vintage: 2019,
      critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    const result = await fetchReviewData(makeWine())

    expect(result).toHaveLength(1)
    expect(result![0].source).toBe('configured')
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
        page_vintage: 2019,
        vintage_gap: 0,
        match: {
          producer: 'match',
          denomination: 'match',
          bottling: 'unknown',
          vintage: 'match',
          candidateVintage: 2019,
          vintageGap: 0,
        },
        page_price: null,
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
    expect(result![0].product_url).toBe('https://www.amsterwine.com/p/1')
    expect(mockRenderPageHtml).not.toHaveBeenCalledWith(expect.stringContaining('cellartracker'))
    expect(mockRenderPageHtml).not.toHaveBeenCalledWith(expect.stringContaining('wineberserkers'))
  })

  it('returns an empty array when the fallback pass also finds nothing', async () => {
    installSerperMock({}, [])

    expect(await fetchReviewData(makeWine())).toEqual([])
  })
})

// ─── URL-shape guard and fallback hygiene (Phase 9.1, WI-8) ────────────────
describe('product page candidate hygiene', () => {
  const woodland: RetailerConfig = {
    slug: 'woodland',
    name: 'Woodland Hills Wine Co.',
    domain: 'whwc.com',
    matchKeyword: 'woodland',
    reviewTier: 'primary',
    lat: 34.1684,
    lng: -118.6059,
  }

  const rousseau = {
    producer: 'Domaine Rousseau',
    denomination: 'Gevrey-Chambertin',
    vintage: 2019,
    cuvee: null,
    vineyard: null,
  }

  function mockOrganic(items: Array<{ title: string; link: string; snippet?: string }>) {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ organic: items }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // All four of these were actually accepted and stored as "product pages"
  // in the 2026-08-04 batch. They returned zero scores, which is luck, not
  // safety: a retailer newsletter covering eight wines with eight scores is
  // exactly the page that would attribute the wrong one.
  it.each([
    ['a PDF report', 'https://images.jjbuckley.com/reports/2011_BORDEAUX_REPORT.pdf'],
    ['an auction bidding-history page', 'https://bid.zachys.com/auctions/bidding-history/12345'],
    ['a retailer offers blog post', 'https://crushwineco.com/blogs/offers/burgundy-2019'],
    ['a cart page', 'https://whwc.com/cart?add=1234'],
  ])('rejects %s before spending a render on it', async (_label, link) => {
    mockOrganic([{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link }])

    const outcome = await findProductPageDetailed(rousseau, woodland, 'test-key')

    expect(outcome.url).toBeNull()
    expect(outcome.stage).toBe('no_relevant_match')
  })

  it('still takes a real product page listed alongside a rejected one', async () => {
    mockOrganic([
      { title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://whwc.com/blogs/offers/burgundy' },
      { title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://whwc.com/products/rousseau-gevrey-2019' },
    ])

    const outcome = await findProductPageDetailed(rousseau, woodland, 'test-key')

    expect(outcome.url).toBe('https://whwc.com/products/rousseau-gevrey-2019')
  })

  it('keeps wine-searcher.com out of the open-web fallback', async () => {
    // Phase 6 migrated away from Wine-Searcher deliberately; the Phase 7.3
    // fallback then handed a wine-searcher.com page back for Montus.
    mockOrganic([
      { title: 'Domaine Rousseau Gevrey-Chambertin 2019 | Wine-Searcher', link: 'https://www.wine-searcher.com/find/rousseau' },
    ])

    const outcome = await findFallbackProductPage(rousseau, 'test-key')

    expect(outcome.url).toBeNull()
  })

  it('does not re-try a domain this run already exhausted as a configured retailer', async () => {
    // Bessin-Tremblay and Dureuil-Janthial both produced
    // `fallback-shop-klwines-com` pointing at the identical URL that had
    // just returned zero as a configured retailer. K&L is documented as
    // permanently bot-blocked at the product-page render.
    mockOrganic([
      { title: 'Domaine Rousseau Gevrey-Chambertin 2019 | K&L', link: 'https://shop.klwines.com/products/details/1557135' },
    ])

    const outcome = await findFallbackProductPage(rousseau, 'test-key', {
      attemptedDomains: ['klwines.com'],
    })

    expect(outcome.url).toBeNull()
  })

  it('still returns an un-attempted domain from the same result set', async () => {
    mockOrganic([
      { title: 'Domaine Rousseau Gevrey-Chambertin 2019 | K&L', link: 'https://shop.klwines.com/products/details/1557135' },
      { title: 'Domaine Rousseau Gevrey-Chambertin 2019 | AmsterWine', link: 'https://www.amsterwine.com/p/1' },
    ])

    const outcome = await findFallbackProductPage(rousseau, 'test-key', {
      attemptedDomains: ['klwines.com'],
    })

    expect(outcome.url).toBe('https://www.amsterwine.com/p/1')
  })

  // 2026-08-15: the open-web fallback query used to drop cuvee/vineyard even
  // though the configured-retailer search above already includes both — for
  // a wine with no vintage set, producer + denomination alone can be too
  // generic to reach the right page. Confirmed live: Olivier Leflaive's
  // Bourgogne entry (no stored vintage) missed a real page on kdwine.com
  // whose own title foregrounds the cuvee ("Les Sétilles"), not the generic
  // denomination.
  it('includes cuvee and vineyard in the open-web query, the same as the configured search does', async () => {
    const queries: string[] = []
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      queries.push((JSON.parse(String(init?.body)) as { q: string }).q)
      return Promise.resolve(
        new Response(JSON.stringify({ organic: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })

    await findFallbackProductPage({
      producer: 'Olivier Leflaive',
      denomination: 'Bourgogne',
      vintage: null,
      cuvee: 'Les Sétilles',
      vineyard: null,
    }, 'test-key')

    expect(queries[0]).toContain('"Les Setilles"')
  })
})

// ─── Cross-feed from modules/price/ (Phase 9.1, WI-7) ──────────────────────
// price/ discovered central-wine-merchants, Wally's and Varmax for Montus;
// this module only ever iterated RETAILER_CONFIG, so it never looked at any
// of them. The router feeds those merchant names back in. It has to be an
// open query with the merchant as a term rather than a site: restriction —
// Serper's Shopping response never carries the merchant's own domain.
describe('fetchReviewData — retailers discovered by the price module', () => {
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

  it('probes a discovered merchant by name when no configured retailer found a score', async () => {
    const queries = installSerperMock({}, [
      {
        title: 'Domaine Rousseau Gevrey-Chambertin 2019 | Central Wine Merchants',
        link: 'https://www.centralwinemerchants.com/p/1',
      },
    ])
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: null,
      url: 'https://www.centralwinemerchants.com/p/1',
      vintage: 2019,
      critic_scores: [{ publication: 'Wine Enthusiast', score: 93, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    const result = await fetchReviewData(makeWine(), {
      discoveredRetailers: [{ slug: 'central-wine-merchants', name: 'Central Wine Merchants' }],
    })

    expect(result).toHaveLength(1)
    expect(result![0].product_url).toBe('https://www.centralwinemerchants.com/p/1')
    expect(result![0].source).toBe('fallback')
    expect(queries.some(q => q.includes('"Central Wine Merchants"'))).toBe(true)
  })

  it('does not probe discovered merchants when a configured retailer already found a score', async () => {
    const queries = installSerperMock({
      'benchmarkwine.com': [{ title: 'Domaine Rousseau Gevrey-Chambertin 2019', link: 'https://www.benchmarkwine.com/p/1' }],
    })
    mockRenderPageHtml.mockResolvedValue('<html>rendered</html>')
    mockExtract.mockResolvedValue({
      price: null,
      url: 'https://www.benchmarkwine.com/p/1',
      vintage: 2019,
      critic_scores: [{ publication: 'Burghound', score: 92, known_publication: true, drinking_window: null, vintage_character: null, deal: false }],
    })

    await fetchReviewData(makeWine(), {
      discoveredRetailers: [{ slug: 'central-wine-merchants', name: 'Central Wine Merchants' }],
    })

    expect(queries.some(q => q.includes('Central Wine Merchants'))).toBe(false)
  })

  it('skips merchants already covered by RETAILER_CONFIG', async () => {
    const queries = installSerperMock({}, [])

    await fetchReviewData(makeWine(), {
      discoveredRetailers: [{ slug: 'zachys', name: 'Zachys' }],
    })

    // Zachys was already searched with a proper site: query in Step 1;
    // probing it again by name would just spend another call.
    expect(queries.some(q => !q.includes('site:') && q.includes('"Zachys"'))).toBe(false)
  })

  it('runs the blind open-web pass only after the discovered merchants also come up empty', async () => {
    const queries = installSerperMock({}, [])

    await fetchReviewData(makeWine(), {
      discoveredRetailers: [{ slug: 'central-wine-merchants', name: 'Central Wine Merchants' }],
    })

    const merchantProbe = queries.findIndex(q => q.includes('"Central Wine Merchants"'))
    const openPass = queries.findIndex(q => !q.includes('site:') && q.includes('review'))
    expect(merchantProbe).toBeGreaterThanOrEqual(0)
    expect(openPass).toBeGreaterThan(merchantProbe)
  })

  it('caps how many discovered merchants are probed', async () => {
    const queries = installSerperMock({}, [])

    await fetchReviewData(makeWine(), {
      discoveredRetailers: Array.from({ length: 8 }, (_, i) => ({
        slug: `shop-${i}`,
        name: `Wine Shop ${i}`,
      })),
    })

    const probes = queries.filter(q => /"Wine Shop \d"/.test(q))
    expect(probes).toHaveLength(3)
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
    expect(result!.toLowerCase()).not.toContain('advocate')
    expect(result!.toLowerCase()).not.toContain('vinous')
  })

  it('Zachys: a real 879K-char product page — the review section (offset 384,907, far past the old 80K cutoff) is captured', () => {
    const html = readFixture('zachys-clos-des-papes-2020.html')
    const result = extractCandidateText(html)
    expect(result!.toLowerCase()).toContain('advocate')
    expect(result).toContain('96+ Points')
    // The whole point of windowing: send far less than the full page.
    expect(result!.length).toBeLessThan(html.length / 10)
  })

  it('Benchmark: a real 189K-char product page — badge-form scores (title attribute + bare number) are captured', () => {
    const html = readFixture('benchmark-clos-des-papes-2020.html')
    const result = extractCandidateText(html)
    expect(result).toContain('title="Vinous"')
    expect(result).toContain('title="The Wine Advocate"')
    expect(result).toContain('title="Decanter"')
  })
})
