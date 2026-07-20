import type { WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from './retailers.config'
import { querySerper } from './serper-query'
import { renderPageHtml } from './puppeteer-extract'
import { pageShowsNoResults } from './verify-listing'
import type { PriceData, RetailerResult } from './types'

function buildQuery(wine: WineEntry): string {
  if (!wine.producer && !wine.denomination) return ''
  const parts = [wine.producer, wine.denomination].filter(Boolean)
  if (wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}

// Every retailer URL at this point is a constructed search-results page
// (see retailer-search-url.ts / buildFallbackUrl), never a single product
// page — but the *price* still comes from Serper's Google Shopping snapshot,
// which can be stale relative to what the retailer's own live search
// actually returns today (delisted, sold out, aged-out snapshot). Rendering
// the real search page and checking for an explicit "no results" signal is
// what catches that: a price is only kept if the retailer's own site still
// backs it up. Returns null to signal "drop this retailer entirely" — a
// wine that isn't actually in this retailer's live search isn't a match,
// so this is a drop, not a downgrade.
async function verifyStillListed(retailer: RetailerResult): Promise<RetailerResult | null> {
  const html = await renderPageHtml(retailer.url)
  // Render failed/timed out — an infra hiccup isn't evidence the listing is
  // gone, so don't punish the retailer for it; keep Serper's data as-is.
  if (!html) return retailer
  if (pageShowsNoResults(html)) return null
  return retailer
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

  // Step 2 — Puppeteer pass: render each retailer's live search page and drop
  // any retailer whose search doesn't actually surface a result today. See
  // verifyStillListed — this is what keeps a stale Serper/Google Shopping
  // price from being shown for a wine a retailer's own site no longer lists.
  const verified = (await Promise.all(baseResults.map(r => verifyStillListed(r))))
    .filter((r): r is RetailerResult => r !== null)
  if (verified.length === 0) return emptyPriceData()
  const enriched = verified

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
