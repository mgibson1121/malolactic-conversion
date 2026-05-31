import { fetchPriceData } from './index'
import type { WineEntry } from '@shared/types'

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

// Minimal HTML fixture for a product page with price and critic scores
const klHtml = `
<html><body>
  <h1>Domaine Leroy Gevrey-Chambertin 2018</h1>
  <span class="price">$249.99</span>
  <div class="scores">
    <span>Burghound: 94</span>
    <span>Vinous: 96</span>
  </div>
</body></html>
`

const emptyHtml = `<html><body><p>No results found.</p></body></html>`

function mockFetch(htmlByUrl: Record<string, string>) {
  return jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const key = Object.keys(htmlByUrl).find(k => String(url).includes(k))
    const html = key ? htmlByUrl[key] : emptyHtml
    return Promise.resolve(
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })
    )
  })
}

function mockOpenAI(extractionsBySlug: Record<string, object>) {
  const openaiModule = jest.requireMock('openai')
  openaiModule.__setExtractions(extractionsBySlug)
}

jest.mock('openai', () => {
  let extractionsBySlug: Record<string, object> = {}
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockImplementation(({ messages }) => {
          const userMsg = messages.find((m: { role: string }) => m.role === 'user')?.content ?? ''
          const slug = Object.keys(extractionsBySlug).find(s => userMsg.includes(s))
          const extraction = slug ? extractionsBySlug[slug] : { price: null, url: '', critic_scores: [] }
          return Promise.resolve({
            choices: [{ message: { content: JSON.stringify(extraction) } }],
          })
        }),
      },
    },
  }))
  ;(MockOpenAI as unknown as { __setExtractions: (e: Record<string, object>) => void }).__setExtractions = (e: Record<string, object>) => {
    extractionsBySlug = e
  }
  return MockOpenAI
})

describe('fetchPriceData', () => {
  const originalKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
    jest.clearAllMocks()
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
    const emptyWine = { ...baseWine, producer: null, denomination: null }
    const result = await fetchPriceData(emptyWine)
    expect(result).toBeNull()
  })

  it('returns null when all retailer fetches fail', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'))
    const result = await fetchPriceData(baseWine)
    expect(result).toBeNull()
  })

  it('aggregates price min/avg/max across retailers', async () => {
    mockFetch({ klwines: klHtml, zachys: klHtml, woodland: klHtml, benchmark: klHtml })
    mockOpenAI({
      klwines: { price: 100, url: 'https://klwines.com/p/1', critic_scores: [{ publication: 'Burghound', score: 92 }] },
      zachys: { price: 120, url: 'https://zachys.com/p/1', critic_scores: [] },
      woodland: { price: 110, url: 'https://woodlandhillswine.com/p/1', critic_scores: [] },
      benchmark: { price: 130, url: 'https://benchmarkwine.com/p/1', critic_scores: [{ publication: 'Vinous', score: 94 }] },
    })

    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.price_min).toBe(100)
    expect(result!.price_max).toBe(130)
    expect(result!.price_avg).toBe(115)
  })

  it('extracts attributed critic scores from retailer pages', async () => {
    mockFetch({ klwines: klHtml })
    mockOpenAI({
      klwines: { price: 249, url: 'https://klwines.com/p/1', critic_scores: [{ publication: 'Burghound', score: 94 }, { publication: 'Vinous', score: 96 }] },
      zachys: { price: null, url: '', critic_scores: [] },
      woodland: { price: null, url: '', critic_scores: [] },
      benchmark: { price: null, url: '', critic_scores: [] },
    })

    const result = await fetchPriceData(baseWine)
    const kl = result!.retailers.find(r => r.slug === 'kl')
    expect(kl?.critic_scores).toHaveLength(2)
    expect(kl?.critic_scores[0].publication).toBe('Burghound')
    expect(kl?.critic_scores[0].score).toBe(94)
  })

  it('identifies nearest retailer to NYC', async () => {
    mockFetch({ klwines: klHtml, zachys: klHtml, woodland: klHtml, benchmark: klHtml })
    mockOpenAI({
      klwines: { price: 100, url: 'https://klwines.com/p/1', critic_scores: [] },
      zachys: { price: 110, url: 'https://zachys.com/p/1', critic_scores: [] },
      woodland: { price: 120, url: 'https://woodlandhillswine.com/p/1', critic_scores: [] },
      benchmark: { price: 130, url: 'https://benchmarkwine.com/p/1', critic_scores: [] },
    })

    const result = await fetchPriceData(baseWine)
    // K&L has a NYC store — closest to the NYC reference point
    expect(result!.nearest_retailer?.slug).toBe('kl')
  })

  it('handles partial retailer failures gracefully', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('klwines')) {
        return Promise.resolve(new Response(klHtml, { status: 200 }))
      }
      return Promise.reject(new Error('timeout'))
    })
    mockOpenAI({
      klwines: { price: 200, url: 'https://klwines.com/p/1', critic_scores: [] },
    })

    const result = await fetchPriceData(baseWine)
    expect(result).not.toBeNull()
    expect(result!.retailers).toHaveLength(1)
    expect(result!.retailers[0].slug).toBe('kl')
  })

  it('includes fetched_at timestamp', async () => {
    mockFetch({ klwines: klHtml })
    mockOpenAI({
      klwines: { price: 100, url: 'https://klwines.com/p/1', critic_scores: [] },
      zachys: { price: null, url: '', critic_scores: [] },
      woodland: { price: null, url: '', critic_scores: [] },
      benchmark: { price: null, url: '', critic_scores: [] },
    })

    const result = await fetchPriceData(baseWine)
    expect(result!.fetched_at).toBeTruthy()
    expect(new Date(result!.fetched_at).getTime()).not.toBeNaN()
  })
})
