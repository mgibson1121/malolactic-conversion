import OpenAI from 'openai'
import type { WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { findProductPage } from './find-product-page'
import type { WineIdentity } from './find-product-page'
import { renderPageHtml } from './puppeteer-extract'
import { extractCandidateText } from './keyword-window'
import { extractFromRenderedHtml } from './gpt-extract'
import type { ReviewResult } from './types'

/**
 * Runs Step 1 (Serper organic search per retailer) and Step 2 (Puppeteer
 * render, window around score citations, GPT-4o extraction) for every
 * configured retailer, independently — one retailer failing (no match,
 * render timeout, no score-citation pattern plus a genuinely empty fallback,
 * no attributed score) never blocks another. K&L is expected to always fail
 * here (bot-blocked at the product-page render, not just its search page —
 * see build-phases.md Phase 7); that's expected, not a bug to chase. Always
 * returns an array, never null: an empty array covers "not configured," "no
 * query to run," and "nothing found" alike, since none of those are error
 * conditions here (CLAUDE.md §5 — modules degrade gracefully, never throw
 * uncaught errors).
 */
export async function fetchReviewData(wine: WineEntry): Promise<ReviewResult[]> {
  const serperKey = process.env.SERPER_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!serperKey || !openaiKey) return []
  if (!wine.producer && !wine.denomination) return []

  const identity: WineIdentity = {
    producer: wine.producer ?? '',
    denomination: wine.denomination ?? '',
    vintage: wine.vintage ?? null,
  }
  const openai = new OpenAI({ apiKey: openaiKey })

  const results = await Promise.all(
    RETAILER_CONFIG.map(async (retailer): Promise<ReviewResult | null> => {
      const productUrl = await findProductPage(identity, retailer, serperKey)
      if (!productUrl) return null

      const html = await renderPageHtml(productUrl)
      if (!html) return null

      const candidateText = extractCandidateText(html)
      const extraction = await extractFromRenderedHtml(openai, candidateText, productUrl)
      if (!extraction) return null

      return {
        slug: retailer.slug,
        name: retailer.name,
        product_url: productUrl,
        critic_scores: extraction.critic_scores,
        fetched_at: new Date().toISOString(),
      }
    })
  )

  return results.filter((r): r is ReviewResult => r !== null)
}
