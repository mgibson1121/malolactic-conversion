import OpenAI from 'openai'
import type { WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from './retailers.config'
import { querySerper } from './serper-query'
import { renderPageHtml } from './puppeteer-extract'
import { extractFromRenderedHtml } from './gpt-extract'
import type { PriceData, RetailerResult } from './types'

function buildQuery(wine: WineEntry): string {
  if (!wine.producer && !wine.denomination) return ''
  const parts = [wine.producer, wine.denomination].filter(Boolean)
  if (wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}

async function enrichWithCriticScores(
  openai: OpenAI,
  retailer: RetailerResult
): Promise<RetailerResult> {
  // Search-results pages never yield attributed scores (the extraction
  // prompt explicitly returns null for them) — skip the Puppeteer render and
  // GPT-4o call entirely rather than paying the full latency cost for a
  // guaranteed empty result. See is_search_results_page in types.ts.
  if (retailer.is_search_results_page) return retailer

  const html = await renderPageHtml(retailer.url)
  if (!html) return retailer

  const extraction = await extractFromRenderedHtml(openai, html, retailer.url)
  if (!extraction) return retailer

  return {
    ...retailer,
    price: extraction.price ?? retailer.price,
    url: extraction.url || retailer.url,
    critic_scores: extraction.critic_scores ?? [],
  }
}

// Distinguishes "never attempted" (returns null — no fetched_at, no stored
// price_data at all) from "attempted and found nothing" (returns a PriceData
// with empty retailers and a fetched_at timestamp). The UI needs this
// distinction to show "no matching listings found" instead of either
// silently showing nothing or, worse, an unrelated/incorrect price.
function emptyPriceData(): PriceData {
  return {
    price_min: null,
    price_avg: null,
    price_max: null,
    retailers: [],
    nearest_retailer: null,
    fetched_at: new Date().toISOString(),
  }
}

export async function fetchPriceData(wine: WineEntry): Promise<PriceData | null> {
  const apiKey = process.env.OPENAI_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!apiKey || !serperKey) return null

  const query = buildQuery(wine)
  if (!query.trim()) return null

  // Step 1 — Serper query: discover retailer URLs + prices
  const baseResults = await querySerper(query, RETAILER_CONFIG, serperKey, {
    producer: wine.producer ?? '',
    denomination: wine.denomination ?? '',
    vintage: wine.vintage ?? null,
  })
  if (baseResults.length === 0) return emptyPriceData()

  // Step 2 — Puppeteer pass: render each SPA page and extract attributed critic scores
  const openai = new OpenAI({ apiKey })
  const enriched = await Promise.all(
    baseResults.map(r => enrichWithCriticScores(openai, r))
  )

  // A confirmed vintage_mismatch means the listing is definitely a different
  // year of this wine, not this wine at that price — it stays in the
  // retailers list (badged in the UI) for transparency, but must not feed
  // the headline price stats or be selectable as "nearest retailer": doing
  // so would present a wrong-vintage price as if it were the answer to "what
  // does this wine cost," which is the same class of error as showing a
  // price for an unrelated wine.
  const vintageConfirmedOrUnknown = enriched.filter(r => !r.vintage_mismatch)

  const withPrice = vintageConfirmedOrUnknown.filter(r => r.price !== null)
  const prices = withPrice.map(r => r.price as number)

  const price_min = prices.length ? Math.min(...prices) : null
  const price_max = prices.length ? Math.max(...prices) : null
  const price_avg =
    prices.length
      ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100
      : null

  // Only preferred retailers are eligible for nearest-to-NYC — fallback results have no coords
  const preferred = vintageConfirmedOrUnknown.filter(r => r.is_preferred_retailer)
  const nearest_retailer =
    preferred.length > 0
      ? [...preferred].sort((a, b) => a.distance_miles - b.distance_miles)[0]
      : vintageConfirmedOrUnknown[0] ?? null

  return {
    price_min,
    price_avg,
    price_max,
    retailers: enriched,
    nearest_retailer,
    fetched_at: new Date().toISOString(),
  }
}
