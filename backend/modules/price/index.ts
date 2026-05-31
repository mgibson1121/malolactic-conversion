import OpenAI from 'openai'
import type { WineEntry } from '@shared/types'
import { haversineDistanceMiles } from '@shared/utils/proximity'
import { RETAILERS, NYC } from './retailer-coords'
import type { CrawlResult, GptPageExtraction, RetailerCrawlResult } from './types'

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
}

// Step 1 prompt: given a search results page, return the URL of the best matching product
const FIND_PRODUCT_PROMPT =
  'You are a structured data extractor. Given the HTML of a wine retailer search results page ' +
  'and a wine query string, find the single best-matching product URL on the page. ' +
  'Return ONLY valid JSON: {"product_url": "<absolute url or null>"}. ' +
  'Return null if no plausible match is found. Do not guess or fabricate URLs.'

// Step 2 prompt: given a product page, extract price and attributed critic scores
const EXTRACT_PRODUCT_PROMPT =
  'You are a structured data extractor. Given the HTML of a wine retailer product page, extract:\n' +
  '1. The bottle price in USD (number or null if not found)\n' +
  '2. The canonical product page URL\n' +
  '3. Any critic scores explicitly attributed to a named publication on the page\n\n' +
  'Return ONLY valid JSON: {"price": <number|null>, "url": "<string>", "critic_scores": [{"publication": "<string>", "score": <number>}]}\n\n' +
  'Only include scores with a clearly named publication (e.g. Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling). ' +
  'If no named publication is visible, omit the score. Never include review text.'

function buildQuery(wine: WineEntry): string {
  if (!wine.producer && !wine.denomination) return ''
  const parts = [wine.producer, wine.denomination].filter(Boolean)
  if (wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function findProductUrl(
  openai: OpenAI,
  searchHtml: string,
  searchUrl: string,
  query: string
): Promise<string | null> {
  const trimmed = searchHtml.slice(0, 60_000)
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: FIND_PRODUCT_PROMPT },
        { role: 'user', content: `Query: "${query}"\nPage URL: ${searchUrl}\n\nHTML:\n${trimmed}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    })
    const text = response.choices[0]?.message?.content
    if (!text) return null
    const parsed = JSON.parse(text) as { product_url: string | null }
    return parsed.product_url ?? null
  } catch {
    return null
  }
}

async function extractFromProductPage(
  openai: OpenAI,
  html: string,
  pageUrl: string
): Promise<GptPageExtraction | null> {
  const trimmed = html.slice(0, 80_000)
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: EXTRACT_PRODUCT_PROMPT },
        { role: 'user', content: `Page URL: ${pageUrl}\n\nHTML:\n${trimmed}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    })
    const text = response.choices[0]?.message?.content
    if (!text) return null
    return JSON.parse(text) as GptPageExtraction
  } catch {
    return null
  }
}

async function crawlRetailer(
  openai: OpenAI,
  retailer: typeof RETAILERS[number],
  query: string,
  distance: number
): Promise<RetailerCrawlResult | null> {
  // Step 1: fetch search results page
  const searchUrl = retailer.searchUrl(query)
  const searchHtml = await fetchHtml(searchUrl)
  if (!searchHtml) return null

  // Step 2: ask GPT-4o to identify the best-matching product URL
  const productUrl = await findProductUrl(openai, searchHtml, searchUrl, query)
  if (!productUrl) return null

  // Step 3: fetch the product page
  const productHtml = await fetchHtml(productUrl)
  if (!productHtml) return null

  // Step 4: extract price and critic scores from the product page
  const extraction = await extractFromProductPage(openai, productHtml, productUrl)
  if (!extraction) return null

  return {
    slug: retailer.slug,
    name: retailer.name,
    price: extraction.price,
    url: extraction.url || productUrl,
    critic_scores: extraction.critic_scores ?? [],
    distance_miles: Math.round(distance),
  }
}

export async function fetchPriceData(wine: WineEntry): Promise<CrawlResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const query = buildQuery(wine)
  if (!query.trim()) return null

  const openai = new OpenAI({ apiKey })

  const results = await Promise.all(
    RETAILERS.map(async (retailer): Promise<RetailerCrawlResult | null> => {
      const distance = haversineDistanceMiles(NYC.lat, NYC.lng, retailer.lat, retailer.lng)
      return crawlRetailer(openai, retailer, query, distance)
    })
  )

  const found = results.filter((r): r is RetailerCrawlResult => r !== null)
  if (found.length === 0) return null

  const withPrice = found.filter(r => r.price !== null)
  const prices = withPrice.map(r => r.price as number)

  const price_min = prices.length ? Math.min(...prices) : null
  const price_max = prices.length ? Math.max(...prices) : null
  const price_avg =
    prices.length
      ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100
      : null

  const nearest_retailer = [...found].sort((a, b) => a.distance_miles - b.distance_miles)[0] ?? null

  return {
    price_min,
    price_avg,
    price_max,
    retailers: found,
    nearest_retailer,
    fetched_at: new Date().toISOString(),
  }
}
