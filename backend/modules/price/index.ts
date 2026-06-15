import OpenAI from 'openai'
import type { WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from './retailers.config'
import { queryGoogleShopping, hitsToRetailerResults } from './shopping-query'
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

export async function fetchPriceData(wine: WineEntry): Promise<PriceData | null> {
  const apiKey = process.env.OPENAI_API_KEY
  const cseApiKey = process.env.GOOGLE_CSE_API_KEY
  const cseId = process.env.GOOGLE_CSE_ID

  if (!apiKey || !cseApiKey || !cseId) return null

  const query = buildQuery(wine)
  if (!query.trim()) return null

  // Step 1 — Google Shopping query: discover retailer URLs + prices
  const hits = await queryGoogleShopping(query, RETAILER_CONFIG, cseApiKey, cseId)
  if (hits.length === 0) return null

  const baseResults = hitsToRetailerResults(hits)

  // Step 2 — Puppeteer pass: render each SPA page and extract attributed critic scores
  const openai = new OpenAI({ apiKey })
  const enriched = await Promise.all(
    baseResults.map(r => enrichWithCriticScores(openai, r))
  )

  const withPrice = enriched.filter(r => r.price !== null)
  const prices = withPrice.map(r => r.price as number)

  const price_min = prices.length ? Math.min(...prices) : null
  const price_max = prices.length ? Math.max(...prices) : null
  const price_avg =
    prices.length
      ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100
      : null

  const nearest_retailer =
    [...enriched].sort((a, b) => a.distance_miles - b.distance_miles)[0] ?? null

  return {
    price_min,
    price_avg,
    price_max,
    retailers: enriched,
    nearest_retailer,
    fetched_at: new Date().toISOString(),
  }
}
