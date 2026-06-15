import { fetchPriceData } from './index'
import type { WineEntry } from '@shared/types'

// ─── Puppeteer mock ──────────────────────────────────────────────────────────
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
const WOODLAND_URL = 'https://www.woodlandhillswine.com/products/leroy'
const BENCHMARK_URL = 'https://www.benchmarkwine.com/products/leroy'
const OTHER_URL = 'https://www.someotherwinestore.com/products/leroy'

const RENDERED_HTML = '<html><body><span class="price">$249.00</span></body></html>'

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
    mockGptCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ price: null, url: '', critic_scores: [] }) } }],
    })
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

  it('returns null when Serper returns no results', async () => {
    mockSerperItems = []
    expect(await fetchPriceData(baseWine)).toBeNull()
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

  it('extracts attributed critic scores from Puppeteer-rendered pages', async () => {
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$249.00')]
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

  it('retains Step 1 price when Puppeteer fails to render a page', async () => {
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$199.00')]
    mockRenderPageHtml.mockResolvedValue(null)
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers[0].price).toBe(199)
    expect(result!.retailers[0].critic_scores).toHaveLength(0)
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

  it('continues enriching other retailers when one Puppeteer call fails', async () => {
    mockSerperItems = [
      makeItem('K&L Wine Merchants', KL_URL, '$200.00'),
      makeItem('Zachys', ZACHYS_URL, '$210.00'),
    ]
    mockRenderPageHtml
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(RENDERED_HTML)
    mockGptCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ price: 210, url: ZACHYS_URL, critic_scores: [{ publication: 'Vinous', score: 93 }] }) } }],
    })
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers).toHaveLength(2)
    const zachys = result!.retailers.find(r => r.slug === 'zachys')
    expect(zachys?.critic_scores[0].publication).toBe('Vinous')
  })

  it('includes fetched_at ISO timestamp', async () => {
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$249.00')]
    const result = await fetchPriceData(baseWine)
    expect(result!.fetched_at).toBeTruthy()
    expect(new Date(result!.fetched_at).getTime()).not.toBeNaN()
  })

  it('Puppeteer/GPT price overrides Serper price when available', async () => {
    mockSerperItems = [makeItem('K&L Wine Merchants', KL_URL, '$200.00')]
    mockGptCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ price: 249, url: KL_URL, critic_scores: [] }) } }],
    })
    const result = await fetchPriceData(baseWine)
    expect(result!.retailers[0].price).toBe(249)
  })
})
