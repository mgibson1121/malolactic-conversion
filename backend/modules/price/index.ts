import type { WineEntry } from '@shared/types'
import { RETAILER_CONFIG, NYC } from '@shared/config/retailers.config'
import { querySerper } from './serper-query'
import { renderPageHtml } from './puppeteer-extract'
import { pageShowsNoResults } from './verify-listing'
import { buildRetailerSearchUrl } from '@shared/utils/retailer-search-url'
import { buildDistinguishingQuery } from '@shared/utils/wine-match'
import { haversineDistanceMiles } from './proximity'
import type { PriceData, RetailerResult } from './types'

// cuvee/vineyard included (2026-07-30 fix) — denomination alone is often
// too generic to reach the actual bottling in Serper's results at all (e.g.
// "Drappier Champagne" surfaces any Drappier Champagne, not specifically
// "Grande Sendrée"). See isRelevantMatch in @shared/utils/wine-match.ts for
// the matching-side half of this fix. buildDistinguishingQuery extracted
// 2026-08-02 — same join logic was duplicated in retailer-links/index.ts.
function buildQuery(wine: WineEntry): string {
  return buildDistinguishingQuery(wine, { includeVintage: true })
}

// Every retailer URL at this point is a constructed search-results page
// (see @shared/utils/retailer-search-url.ts / buildFallbackUrl), never a single product
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

// K&L link-only entry (added 2026-07-30): K&L's own site blocks Puppeteer
// behind a bot-detection challenge — confirmed live by navigating directly
// to the exact search URL this module constructs, which redirects to a
// "Verification Required" slider stub instead of real results (matches the
// ~2,600-character bot-detection stub already documented for K&L's product
// pages in build-phases.md Phase 7). That means verify-listing.ts's live
// "still listed" check can never actually confirm or refute a K&L price —
// left unhandled, it would silently rubber-stamp whatever Serper's Google
// Shopping snapshot says, indistinguishable in the UI from a genuinely
// verified price. But K&L is also where the developer finds most of the
// wines they're after, so dropping it from the retailer list entirely isn't
// the right trade either. K&L is excluded from the Serper-sourced
// matching/verification pipeline entirely (see querySerper's `nonKlItems`
// filtering) and instead always gets this single link-only entry built
// straight from RETAILER_CONFIG: no price, not verified, never counted
// toward price_min/avg/max or nearest_retailer (see aggregatePriceData),
// and — critically — never able to satisfy Pass 1's "a preferred retailer
// matched" condition, so a wine only K&L happens to carry still cascades to
// Pass 2 fallback retailers with real, verifiable pricing instead of
// stopping at K&L with nothing usable.
//
// Uses a vintage-free query, same reasoning as retailer-links/index.ts's
// buildQuery (Phase 7.2) — K&L's on-site search is literal/narrow enough
// that an added vintage risks looking like "no results" even when K&L
// carries the wine under a different vintage's listing.
function buildKlLinkOnlyResult(wine: WineEntry): RetailerResult | null {
  const kl = RETAILER_CONFIG.find(r => r.slug === 'kl')
  if (!kl) return null
  // cuvee/vineyard included (2026-07-30) — same reasoning as buildQuery
  // above: without it, K&L's own search box can just as easily land the
  // user on a different, cheaper bottling from the same producer/denomination.
  const query = buildDistinguishingQuery(wine)
  if (!query) return null

  return {
    slug: kl.slug,
    name: kl.name,
    price: null,
    url: buildRetailerSearchUrl(kl, query),
    is_preferred_retailer: true,
    distance_miles: Math.round(haversineDistanceMiles(NYC.lat, NYC.lng, kl.lat, kl.lng)),
    is_search_results_page: true,
    matched_vintage: null,
    vintage_mismatch: false,
    pack_quantity: 1,
    bottle_size_ml: null,
    non_standard_format: false,
    format_label: '',
    link_only: true,
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

/**
 * Computes price_min/avg/max and nearest_retailer from a retailers list.
 * Pure — no I/O. Exported so callers that already have a RetailerResult[]
 * from somewhere other than a fresh fetchPriceData run (e.g. the
 * confirm-retailer-link flow, which updates one retailer's entry and needs
 * to recompute the aggregate) don't have to duplicate this math.
 */
export function aggregatePriceData(retailers: RetailerResult[]): PriceData {
  // A confirmed vintage_mismatch means the listing is definitely a different
  // year of this wine, not this wine at that price. A non_standard_format
  // listing (a 6-pack, a magnum, a half bottle) means the price isn't for a
  // single standard 750ml bottle at all — a 6-pack can inflate price_max by
  // 5-6x, a magnum typically carries a rarity premium well past 2x. Both
  // stay in the retailers list (badged in the UI) for transparency, but
  // neither may feed the headline price stats or be selectable as "nearest
  // retailer": doing so would present a wrong-vintage or wrong-quantity
  // price as if it were the answer to "what does a bottle of this wine
  // cost," which is the same class of error as showing a price for an
  // unrelated wine. A link_only entry (K&L — see buildKlLinkOnlyResult) has
  // no verifiable price at all and must never win "nearest retailer" on the
  // strength of its coordinates alone with nothing backing up the price.
  const eligibleForStats = retailers.filter(r => !r.vintage_mismatch && !r.non_standard_format && !r.link_only)

  const withPrice = eligibleForStats.filter(r => r.price !== null)
  const prices = withPrice.map(r => r.price as number)

  const price_min = prices.length ? Math.min(...prices) : null
  const price_max = prices.length ? Math.max(...prices) : null
  const price_avg =
    prices.length
      ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100
      : null

  // Only preferred retailers are eligible for nearest-to-NYC — fallback results have no coords
  const preferred = eligibleForStats.filter(r => r.is_preferred_retailer)
  const nearest_retailer =
    preferred.length > 0
      ? [...preferred].sort((a, b) => a.distance_miles - b.distance_miles)[0]
      : eligibleForStats[0] ?? null

  return {
    price_min,
    price_avg,
    price_max,
    retailers,
    nearest_retailer,
    fetched_at: new Date().toISOString(),
  }
}

export async function fetchPriceData(wine: WineEntry): Promise<PriceData | null> {
  const apiKey = process.env.OPENAI_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!apiKey || !serperKey) return null

  const query = buildQuery(wine)
  if (!query.trim()) return null

  // Step 1 — Serper query: discover retailer URLs + prices (K&L excluded — see querySerper)
  const baseResults = await querySerper(query, RETAILER_CONFIG, serperKey, {
    producer: wine.producer ?? '',
    denomination: wine.denomination ?? '',
    vintage: wine.vintage ?? null,
    cuvee: wine.cuvee,
    vineyard: wine.vineyard,
  })

  // Step 2 — Puppeteer pass: render each retailer's live search page and drop
  // any retailer whose search doesn't actually surface a result today. See
  // verifyStillListed — this is what keeps a stale Serper/Google Shopping
  // price from being shown for a wine a retailer's own site no longer lists.
  // Skipped entirely when baseResults is empty rather than launching a
  // Puppeteer browser for nothing.
  const verified = baseResults.length
    ? (await Promise.all(baseResults.map(r => verifyStillListed(r)))).filter((r): r is RetailerResult => r !== null)
    : []

  // K&L's link-only entry is added unconditionally, independent of whatever
  // Serper found or verify-listing confirmed — see buildKlLinkOnlyResult.
  const klLink = buildKlLinkOnlyResult(wine)
  const allRetailers = klLink ? [...verified, klLink] : verified

  if (allRetailers.length === 0) return emptyPriceData()
  return aggregatePriceData(allRetailers)
}
