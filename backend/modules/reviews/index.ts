import OpenAI from 'openai'
import type { WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { findProductPage, findFallbackProductPage } from './find-product-page'
import type { WineIdentity } from './find-product-page'
import { renderPageHtml } from './puppeteer-extract'
import { extractCandidateText } from './keyword-window'
import { extractFromRenderedHtml } from './gpt-extract'
import type { ReviewResult } from './types'

/** Derives a display name/slug for an open-web fallback result, which isn't
 * backed by a RETAILER_CONFIG entry. Prefixed 'fallback-' so it can never
 * collide with a real configured slug. */
function labelFromUrl(url: string): { slug: string; name: string } {
  let hostname = 'unknown-source'
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    // Unparseable URL shouldn't happen here (it came from Serper's own
    // `link` field) — fall through to the placeholder above.
  }
  return {
    slug: `fallback-${hostname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`,
    name: hostname,
  }
}

/** Step 2 (render, window, extract) against one confirmed product URL —
 * shared by the configured-retailer loop and the open-web fallback pass
 * below, since both need the identical render/extract pipeline. */
async function renderAndExtract(openai: OpenAI, url: string) {
  const html = await renderPageHtml(url)
  if (!html) return null
  const candidateText = extractCandidateText(html)
  return extractFromRenderedHtml(openai, candidateText, url)
}

/**
 * Open-web fallback pass (Phase 7.3, 2026-08-02 — specced 2026-07-29 as part
 * of the same phase that expanded RETAILER_CONFIG, but never actually wired
 * up until now; see build-phases.md Phase 7.3). Mirrors the price module's
 * Pass 1 (preferred) / Pass 2 (open fallback) pattern, which reviews never
 * had. Only called when every configured retailer returned zero critic
 * scores — see fetchReviewData below.
 */
async function fetchFallbackReview(
  identity: WineIdentity,
  openai: OpenAI,
  serperKey: string
): Promise<ReviewResult | null> {
  const outcome = await findFallbackProductPage(identity, serperKey)
  if (!outcome.url) return null

  const extraction = await renderAndExtract(openai, outcome.url)
  if (!extraction) return null

  const { slug, name } = labelFromUrl(outcome.url)
  return {
    slug,
    name,
    product_url: outcome.url,
    critic_scores: extraction.critic_scores,
    fetched_at: new Date().toISOString(),
    source: 'fallback',
  }
}

/**
 * Runs Step 1 (Serper organic search per retailer) and Step 2 (Puppeteer
 * render, window around score citations, GPT-4o extraction) for every
 * configured retailer, independently — one retailer failing (no match,
 * render timeout, no score-citation pattern plus a genuinely empty fallback,
 * no attributed score) never blocks another. K&L is expected to always fail
 * here (bot-blocked at the product-page render, not just its search page —
 * see build-phases.md Phase 7); that's expected, not a bug to chase.
 *
 * If every configured retailer comes back with zero critic scores (not just
 * zero matched retailers — a retailer whose page rendered fine but cited no
 * score still counts as "nothing"), runs one open-web fallback pass
 * (fetchFallbackReview) before giving up — see that function's docs. Gated
 * on this "nothing at all" condition, not run unconditionally, so a wine
 * already covered by a configured retailer never triggers the extra
 * Serper/Puppeteer/GPT-4o cost.
 *
 * Always returns an array, never null: an empty array covers "not
 * configured," "no query to run," and "nothing found anywhere, including
 * the fallback" alike, since none of those are error conditions here
 * (CLAUDE.md §5 — modules degrade gracefully, never throw uncaught errors).
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
    cuvee: wine.cuvee,
    vineyard: wine.vineyard,
  }
  const openai = new OpenAI({ apiKey: openaiKey })

  const configuredResults = await Promise.all(
    RETAILER_CONFIG.map(async (retailer): Promise<ReviewResult | null> => {
      const productUrl = await findProductPage(identity, retailer, serperKey)
      if (!productUrl) return null

      const extraction = await renderAndExtract(openai, productUrl)
      if (!extraction) return null

      return {
        slug: retailer.slug,
        name: retailer.name,
        product_url: productUrl,
        critic_scores: extraction.critic_scores,
        fetched_at: new Date().toISOString(),
        source: 'configured',
      }
    })
  )

  const results = configuredResults.filter((r): r is ReviewResult => r !== null)

  const hasAnyScore = results.some(r => r.critic_scores.length > 0)
  if (!hasAnyScore) {
    const fallback = await fetchFallbackReview(identity, openai, serperKey)
    if (fallback) results.push(fallback)
  }

  return results
}
