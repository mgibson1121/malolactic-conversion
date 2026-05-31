import { fetchPriceData } from './index'
import type { WineEntry } from '@shared/types'

// Module-level config controlled by each test
const mockConfig = {
  productUrls: {} as Record<string, string | null>,  // slug → product URL (null = not found)
  extractions: {} as Record<string, { price: number | null; critic_scores: Array<{ publication: string; score: number }> }>,
}

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockImplementation(({ messages }: { messages: Array<{ role: string; content: string }> }) => {
          const system = messages.find(m => m.role === 'system')?.content ?? ''
          const user = messages.find(m => m.role === 'user')?.content ?? ''

          if (system.includes('best-matching product URL')) {
            // Step 1: find product URL — identify retailer from search URL in user content
            const slug = user.includes('klwines') ? 'kl'
              : user.includes('zachys') ? 'zachys'
              : user.includes('woodland') ? 'woodland'
              : user.includes('benchmark') ? 'benchmark'
              : null
            const productUrl = slug ? (mockConfig.productUrls[slug] ?? null) : null
            return Promise.resolve({
              choices: [{ message: { content: JSON.stringify({ product_url: productUrl }) } }],
            })
          } else {
            // Step 2: extract from product page — identify retailer from product URL
            const slug = user.includes('klwines') ? 'kl'
              : user.includes('zachys') ? 'zachys'
              : user.includes('woodland') ? 'woodland'
              : user.includes('benchmark') ? 'benchmark'
              : null
            const extraction = slug ? (mockConfig.extractions[slug] ?? { price: null, critic_scores: [] }) : { price: null, critic_scores: [] }
            return Promise.resolve({
              choices: [{ message: { content: JSON.stringify({ price: extraction.price, url: user.match(/Page URL: (\S+)/)?.[1] ?? '', critic_scores: extraction.critic_scores }) } }],
            })
          }
        }),
      },
    },
  }))
})

const SEARCH_HTML = `<html><body><a href="/p/1">Domaine Leroy Gevrey-Chambertin 2018</a></body></html>`
const PRODUCT_HTML = `<html><body><span class="price">$249</span></body></html>`

const PRODUCT_URLS = {
  kl: 'https://www.klwines.com/p/i?i=1',
  zachys: 'https://www.zachys.com/product/1',
  woodland: 'https://www.woodlandhillswine.com/products/1',
  benchmark: 'https://www.benchmarkwine.com/products/1',
}

function setupFetch() {
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const u = String(url)
    const isProduct = /\/p\/i|\/product\/|\/products\//.test(u)
    const html = isProduct ? PRODUCT_HTML : SEARCH_HTML
    return Promise.resolve(new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }))
  })
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

describe('fetchPriceData', () => {
  const originalKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
    // Default: all retailers return a product URL and a price of 100
    mockConfig.productUrls = { kl: PRODUCT_URLS.kl, zachys: PRODUCT_URLS.zachys, woodland: PRODUCT_URLS.woodland, benchmark: PRODUCT_URLS.benchmark }
    mockConfig.extractions = {
      kl: { price: 100, critic_scores: [] },
      zachys: { price: 100, critic_scores: [] },
      woodland: { price: 100, critic_scores: [] },
      benchmark: { price: 100, critic_scores: [] },
    }
  })

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey
    jest.restoreAllMocks()
  })

  it('returns null when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY
    const result = await fetchPriceData(baseWine)
    expect(result).toBeNull()
  })

  it('returns null when wine has no producer or denomination', async () => {
    const result = await fetchPriceData({ ...baseWine, producer: null, denomination: null })
    expect(result).toBeNull()
  })

  it('returns null when all retailer fetches fail', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'))
    const result = await fetchPriceData(baseWine)
    expect(result).toBeNull()
  })

  it('returns null when no product URLs are found', async () => {
    setupFetch()
    mockConfig.productUrls = { kl: null, zachys: null, woodland: null, benchmark: null }
    const result = await fetchPriceData(baseWine)
    expect(result).toBeNull()
  })

  it('aggregates price min/avg/max across retailers', async () => {
    setupFetch()
    mockConfig.extractions = {
      kl: { price: 100, critic_scores: [] },
      zachys: { price: 120, critic_scores: [] },
      woodland: { price: 110, critic_scores: [] },
      benchmark: { price: 130, critic_scores: [] },
    }
    const result = await fetchPriceData(baseWine)
    expect(result!.price_min).toBe(100)
    expect(result!.price_max).toBe(130)
    expect(result!.price_avg).toBe(115)
  })

  it('extracts attributed critic scores from product pages', async () => {
    setupFetch()
    mockConfig.extractions.kl = {
      price: 249,
      critic_scores: [{ publication: 'Burghound', score: 94 }, { publication: 'Vinous', score: 96 }],
    }
    const result = await fetchPriceData(baseWine)
    const kl = result!.retailers.find(r => r.slug === 'kl')
    expect(kl?.critic_scores).toHaveLength(2)
    expect(kl?.critic_scores[0].publication).toBe('Burghound')
    expect(kl?.critic_scores[0].score).toBe(94)
  })

  it('identifies nearest retailer to NYC', async () => {
    setupFetch()
    const result = await fetchPriceData(baseWine)
    // K&L has a NYC store — closest to the NYC reference point
    expect(result!.nearest_retailer?.slug).toBe('kl')
  })

  it('handles partial retailer fetch failures gracefully', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('klwines')) {
        return Promise.resolve(new Response(SEARCH_HTML, { status: 200 }))
      }
      return Promise.reject(new Error('timeout'))
    })
    mockConfig.productUrls = { kl: PRODUCT_URLS.kl, zachys: null, woodland: null, benchmark: null }
    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers).toHaveLength(1)
    expect(result!.retailers[0].slug).toBe('kl')
  })

  it('includes fetched_at timestamp', async () => {
    setupFetch()
    const result = await fetchPriceData(baseWine)
    expect(result!.fetched_at).toBeTruthy()
    expect(new Date(result!.fetched_at).getTime()).not.toBeNaN()
  })
})
