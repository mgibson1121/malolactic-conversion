import { fetchPriceData } from './index'
import type { WineEntry } from '@shared/types'

// ─── Puppeteer mock ──────────────────────────────────────────────────────────
// renderPageHtml is mocked so Puppeteer never runs in tests
jest.mock('./puppeteer-extract', () => ({
  renderPageHtml: jest.fn(),
}))
import { renderPageHtml } from './puppeteer-extract'
const mockRenderPageHtml = renderPageHtml as jest.MockedFunction<typeof renderPageHtml>

// ─── OpenAI mock ─────────────────────────────────────────────────────────────
const mockGptCreate = jest.fn()
jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockGptCreate } },
  }))
)

// ─── Google CSE fetch mock ────────────────────────────────────────────────────
// Controlled per-test via mockCseItems
let mockCseItems: Array<{ link: string; displayLink: string; title: string; snippet?: string; pagemap?: { offer?: Array<{ price?: string }> } }> = []

const originalFetch = global.fetch
beforeEach(() => {
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    if (String(url).includes('googleapis.com/customsearch')) {
      return Promise.resolve(
        new Response(JSON.stringify({ items: mockCseItems }), {
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
  mockCseItems = []
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const KL_URL = 'https://www.klwines.com/p/i?i=1234567'
const ZACHYS_URL = 'https://www.zachys.com/products/leroy-gevrey-2018'
const WOODLAND_URL = 'https://www.woodlandhillswine.com/products/leroy'
const BENCHMARK_URL = 'https://www.benchmarkwine.com/products/leroy'

const RENDERED_HTML = '<html><body><span class="price">$249.00</span><span data-pub="Burghound">94</span></body></html>'

function makeCseItem(domain: string, url: string, price?: string) {
  return {
    link: url,
    displayLink: domain,
    title: 'Domaine Leroy Gevrey-Chambertin 2018',
    snippet: price ? `$${price} · In stock` : undefined,
    pagemap: price ? { offer: [{ price }] } : undefined,
  }
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
    process.env.GOOGLE_CSE_API_KEY = 'test-cse-key'
    process.env.GOOGLE_CSE_ID = 'test-cse-id'
    // Default: Puppeteer returns rendered HTML; GPT-4o returns empty extraction
    mockRenderPageHtml.mockResolvedValue(RENDERED_HTML)
    mockGptCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ price: null, url: '', critic_scores: [] }) } }],
    })
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.GOOGLE_CSE_API_KEY
    delete process.env.GOOGLE_CSE_ID
  })

  it('returns null when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY
    expect(await fetchPriceData(baseWine)).toBeNull()
  })

  it('returns null when GOOGLE_CSE_API_KEY is not set', async () => {
    delete process.env.GOOGLE_CSE_API_KEY
    expect(await fetchPriceData(baseWine)).toBeNull()
  })

  it('returns null when GOOGLE_CSE_ID is not set', async () => {
    delete process.env.GOOGLE_CSE_ID
    expect(await fetchPriceData(baseWine)).toBeNull()
  })

  it('returns null when wine has no producer or denomination', async () => {
    expect(await fetchPriceData({ ...baseWine, producer: null, denomination: null })).toBeNull()
  })

  it('returns null when Google Shopping returns no retailer matches', async () => {
    mockCseItems = [] // CSE returns empty
    expect(await fetchPriceData(baseWine)).toBeNull()
  })

  it('filters CSE results by configured retailer domain', async () => {
    // Only K&L matches; unknown domain should be ignored
    mockCseItems = [
      makeCseItem('klwines.com', KL_URL, '249'),
      makeCseItem('wine-searcher.com', 'https://wine-searcher.com/find/leroy', '200'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers).toHaveLength(1)
    expect(result!.retailers[0].slug).toBe('kl')
  })

  it('computes price_min/avg/max from Google Shopping prices', async () => {
    mockCseItems = [
      makeCseItem('klwines.com', KL_URL, '100'),
      makeCseItem('zachys.com', ZACHYS_URL, '120'),
      makeCseItem('woodlandhillswine.com', WOODLAND_URL, '110'),
      makeCseItem('benchmarkwine.com', BENCHMARK_URL, '130'),
    ]
    const result = await fetchPriceData(baseWine)
    expect(result!.price_min).toBe(100)
    expect(result!.price_max).toBe(130)
    expect(result!.price_avg).toBe(115)
  })

  it('extracts attributed critic scores from Puppeteer-rendered pages', async () => {
    mockCseItems = [makeCseItem('klwines.com', KL_URL, '249')]
    mockGptCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            price: 249,
            url: KL_URL,
            critic_scores: [
              { publication: 'Burghound', score: 94 },
              { publication: 'Vinous', score: 96 },
            ],
          }),
        },
      }],
    })
    const result = await fetchPriceData(baseWine)
    const kl = result!.retailers.find(r => r.slug === 'kl')
    expect(kl?.critic_scores).toHaveLength(2)
    expect(kl?.critic_scores[0].publication).toBe('Burghound')
    expect(kl?.critic_scores[0].score).toBe(94)
  })

  it('keeps Step 1 price when Puppeteer fails to render a page', async () => {
    mockCseItems = [makeCseItem('klwines.com', KL_URL, '199')]
    mockRenderPageHtml.mockResolvedValue(null) // Puppeteer fails
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    // Price from CSE (Step 1) is retained
    expect(result!.retailers[0].price).toBe(199)
    expect(result!.retailers[0].critic_scores).toHaveLength(0)
  })

  it('identifies nearest retailer to NYC by Haversine distance', async () => {
    mockCseItems = [
      makeCseItem('klwines.com', KL_URL, '200'),
      makeCseItem('benchmarkwine.com', BENCHMARK_URL, '200'),
    ]
    const result = await fetchPriceData(baseWine)
    // K&L NYC store is closest to NYC reference point
    expect(result!.nearest_retailer?.slug).toBe('kl')
  })

  it('continues enriching remaining retailers when one Puppeteer call fails', async () => {
    mockCseItems = [
      makeCseItem('klwines.com', KL_URL, '200'),
      makeCseItem('zachys.com', ZACHYS_URL, '210'),
    ]
    mockRenderPageHtml
      .mockResolvedValueOnce(null) // K&L fails
      .mockResolvedValueOnce(RENDERED_HTML) // Zachys succeeds
    mockGptCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ price: 210, url: ZACHYS_URL, critic_scores: [{ publication: 'Vinous', score: 93 }] }) } }],
    })
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(2)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.critic_scores[0].publication).toBe('Vinous')
  })

  it('includes fetched_at ISO timestamp', async () => {
    mockCseItems = [makeCseItem('klwines.com', KL_URL, '249')]
    const result = await fetchPriceData(baseWine)
    expect(result!.fetched_at).toBeTruthy()
    expect(new Date(result!.fetched_at).getTime()).not.toBeNaN()
  })

  it('uses price from Puppeteer/GPT extraction when it overrides CSE price', async () => {
    mockCseItems = [makeCseItem('klwines.com', KL_URL, '200')]
    mockGptCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ price: 249, url: KL_URL, critic_scores: [] }) } }],
    })
    const result = await fetchPriceData(baseWine)
    // GPT extraction price (249) takes precedence over CSE price (200)
    expect(result!.retailers[0].price).toBe(249)
  })
})
