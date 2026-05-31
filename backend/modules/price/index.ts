import OpenAI from 'openai'
import type { WineEntry } from '@shared/types'
import { haversineDistanceMiles } from '@shared/utils/proximity'
import { RETAILERS, NYC } from './retailer-coords'
import type { CrawlResult, GptPageExtraction, RetailerCrawlResult } from './types'

const EXTRACTION_SYSTEM_PROMPT =
  'You are a structured data extractor. Given the HTML of a wine retailer product page, extract:\n' +
  '1. The bottle price in USD (number or null if not found)\n' +
  '2. The page URL\n' +
  '3. Any critic scores that are explicitly attributed to a named publication on the page\n\n' +
  'Return ONLY valid JSON in this exact shape:\n' +
  '{"price": <number|null>, "url": "<string>", "critic_scores": [{"publication": "<string>", "score": <number>}]}\n\n' +
  'Do not include review text. Only extract scores with a clearly named publication source. ' +
  'If a score has no named publication, omit it. ' +
  'If the page is a search results page (not a single product page), return {"price": null, "url": "<url>", "critic_scores": []}.'

function buildQuery(wine: WineEntry): string {
  // Require at least producer or denomination — vintage alone is too ambiguous
  if (!wine.producer && !wine.denomination) return ''
  const parts = [wine.producer, wine.denomination].filter(Boolean)
  if (wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}

async function fetchRetailerHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function extractFromHtml(
  openai: OpenAI,
  html: string,
  pageUrl: string
): Promise<GptPageExtraction | null> {
  // Trim HTML to stay within token budget — first 80k chars covers most product pages
  const trimmed = html.slice(0, 80_000)
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Page URL: ${pageUrl}\n\nHTML:\n${trimmed}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    })
    const text = response.choices[0]?.message?.content
    if (!text) return null
    const parsed = JSON.parse(text) as GptPageExtraction
    return parsed
  } catch {
    return null
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
      const searchUrl = retailer.searchUrl(query)
      const html = await fetchRetailerHtml(searchUrl)
      if (!html) return null

      const extraction = await extractFromHtml(openai, html, searchUrl)
      if (!extraction) return null

      const distance = haversineDistanceMiles(NYC.lat, NYC.lng, retailer.lat, retailer.lng)

      return {
        slug: retailer.slug,
        name: retailer.name,
        price: extraction.price,
        url: extraction.url || searchUrl,
        critic_scores: extraction.critic_scores ?? [],
        distance_miles: Math.round(distance),
      }
    })
  )

  const found = results.filter((r): r is RetailerCrawlResult => r !== null)
  if (found.length === 0) return null

  const withPrice = found.filter(r => r.price !== null)
  const prices = withPrice.map(r => r.price as number)

  const price_min = prices.length ? Math.min(...prices) : null
  const price_max = prices.length ? Math.max(...prices) : null
  const price_avg =
    prices.length ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100 : null

  const nearest_retailer = found.sort((a, b) => a.distance_miles - b.distance_miles)[0] ?? null

  return {
    price_min,
    price_avg,
    price_max,
    retailers: found,
    nearest_retailer,
    fetched_at: new Date().toISOString(),
  }
}
