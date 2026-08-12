import type { WineEntry } from '@shared/types'
import { RETAILER_CONFIG, NYC } from '@shared/config/retailers.config'
import { querySerper } from './serper-query'
import { renderPageHtml } from './puppeteer-extract'
import { pageShowsNoResults, pageMentionsProducer } from './verify-listing'
import { buildRetailerSearchUrl } from '@shared/utils/retailer-search-url'
import { buildDistinguishingQuery } from '@shared/utils/wine-match'
import { haversineDistanceMiles } from './proximity'
import type { ConfirmedProductPage, PriceData, RetailerResult } from './types'

// Two queries, deliberately different (Phase 9.1). They were one string, and
// that is the entire dead-link defect: the vintage belongs in the Serper
// Shopping query (relevance-ranked — a year narrows toward the right listing)
// and must not be in the URL handed to a retailer's own on-site search
// (literal — a year they don't stock turns real listings into "no results").
// Six for six of the reported dead links were a retailer matched on one
// vintage and then linked with another. See querySerper's param docs, and
// retailer-links/index.ts's buildQuery, which made this call in Phase 7.2.
//
// cuvee/vineyard included in both (2026-07-30 fix) — denomination alone is
// often too generic to reach the actual bottling at all (e.g. "Drappier
// Champagne" surfaces any Drappier Champagne, not specifically "Grande
// Sendrée"). buildDistinguishingQuery extracted 2026-08-02 — the same join
// logic was duplicated in retailer-links/index.ts.
function buildSearchQuery(wine: WineEntry): string {
  return buildDistinguishingQuery(wine, { includeVintage: true })
}

function buildLinkQuery(wine: WineEntry): string {
  return buildDistinguishingQuery(wine)
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
/**
 * Is this URL actually the retailer's own site? (2026-08-05)
 *
 * Pass 2 fallback retailers have no known site-search pattern, so their URL
 * is a constructed `google.com/search?q=<merchant> <wine>` — see
 * buildFallbackUrl in serper-query.ts. Rendering *that* and asking what it
 * says about the wine is asking Google, not the shop, and Google serves
 * Puppeteer a ~3.4KB "please enable javascript" interstitial anyway.
 *
 * This distinction was harmless until Phase 9.1 added a positive
 * verification signal: an interstitial never contains a "no results" phrase,
 * so fallback retailers used to pass vacuously, and now they fail vacuously
 * — which silently dropped every Pass 2 retailer that had a real price.
 * Neither answer was ever informative. 'unverified' is the honest one.
 */
function isRetailerOwnPage(retailer: RetailerResult): boolean {
  const config = RETAILER_CONFIG.find(r => r.slug === retailer.slug)
  if (!config) return false
  try {
    return new URL(retailer.url).hostname.toLowerCase().endsWith(config.domain.toLowerCase())
  } catch {
    return false
  }
}

async function verifyStillListed(
  retailer: RetailerResult,
  producer: string | null
): Promise<RetailerResult | null> {
  // Not the shop's own page — nothing renderable here can confirm or refute
  // the listing, so don't spend a Puppeteer launch to find that out.
  if (!isRetailerOwnPage(retailer)) return { ...retailer, verification: 'unverified' }

  const html = await renderPageHtml(retailer.url)

  // Render failed/timed out. An infra hiccup still isn't evidence the
  // listing is gone, so the retailer is kept — but it is no longer reported
  // as if the check had passed. Before Phase 9.1 this returned the retailer
  // unchanged, making an unverifiable listing indistinguishable from a
  // verified one all the way to the UI.
  if (!html) return { ...retailer, verification: 'unverified' }

  if (pageShowsNoResults(html)) return null

  // Positive signal (Phase 9.1). pageShowsNoResults is an allowlist of eight
  // English phrasings, so a retailer whose empty-state copy isn't on it
  // passes by default — Benchmark, Zachys, Woodland Hills and Flatiron all
  // did, while serving dead links. Asking whether the producer's name is on
  // the page answers the question directly instead of guessing at how they
  // phrase failure. Absence is a drop: the page rendered, and this
  // producer's name is not on it.
  const mentionsProducer = pageMentionsProducer(html, producer)
  if (mentionsProducer === false) return null

  // null means the question couldn't be asked (no producer recorded), which
  // is not the same as a pass.
  return { ...retailer, verification: mentionsProducer === true ? 'verified' : 'unverified' }
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
//
// Gated as of Phase 9.1, on querySerper's klItemSeen: this entry is offered
// only when Serper's Shopping snapshot actually showed a relevant K&L
// listing for the wine. "K&L's price can't be verified" was being conflated
// with "we have no idea whether K&L stocks it" — the second was never true,
// the evidence was computed and discarded, and the entry went onto every
// wine regardless. Deleuze-Rochetin's entire retailer list was one K&L
// entry for a wine K&L doesn't stock; so was Mangot's. That is not a
// matching bug — K&L was never matched at all.
//
// Second-order, and the reason this matters beyond one wrong row: because
// something was always appended, `allRetailers.length === 0` became
// unreachable, so emptyPriceData() never fired and the "attempted and found
// nothing" state its own comment exists to preserve was destroyed by a
// change made elsewhere. Gating restores it.
//
// Note the flag comes from a Serper *snapshot*, which is why this stays a
// link and never a price: the snapshot is evidence enough to be worth a
// look, never evidence enough to quote.
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
    // Nothing was matched at all — this entry is a constructed link, not a
    // listing — so the honest vintage verdict is 'unknown', not the `false`
    // that vintage_mismatch alone would imply.
    vintage_verdict: 'unknown',
    pack_quantity: 1,
    bottle_size_ml: null,
    non_standard_format: false,
    format_label: '',
    link_only: true,
    // K&L's site blocks the renderer, so this can never be checked — that
    // is the whole reason the entry carries no price. See CLAUDE.md §15 on
    // not pursuing bot-detection evasion.
    verification: 'unchecked',
  }
}

/**
 * Turns product pages another module already confirmed into retailer entries
 * (Phase 9.1) — see ConfirmedProductPage in ./types.
 *
 * Only pages for shops this run didn't already produce are added, so a
 * retailer with a real Serper price keeps it. The entries carry no price
 * (`link_only`): the pipeline never saw one for these, and inventing one
 * from a review page's list price is exactly the blending CLAUDE.md §15
 * forbids. Unlike everything else here, `url` is a genuine single product
 * page rather than a constructed search — which is why is_search_results_page
 * is false and verify-listing is not run against them: the page was already
 * rendered successfully by the module that found it.
 */
function confirmedPageResults(
  pages: ConfirmedProductPage[],
  existing: RetailerResult[]
): RetailerResult[] {
  const seen = new Set(existing.map(r => r.slug))
  const results: RetailerResult[] = []

  for (const page of pages) {
    if (seen.has(page.slug)) continue
    seen.add(page.slug)
    const configured = RETAILER_CONFIG.find(r => r.slug === page.slug)
    results.push({
      slug: page.slug,
      name: page.name,
      price: null,
      url: page.product_url,
      is_preferred_retailer: configured !== undefined,
      distance_miles: configured
        ? Math.round(haversineDistanceMiles(NYC.lat, NYC.lng, configured.lat, configured.lng))
        : 0,
      is_search_results_page: false,
      matched_vintage: null,
      vintage_mismatch: false,
      // The review side owns this wine's vintage verdict for this page; it
      // is recorded there, on the RetailerReview. Re-deriving a second,
      // possibly different answer here is how the four dimensions drifted
      // apart in the first place.
      vintage_verdict: 'unknown',
      pack_quantity: 1,
      bottle_size_ml: null,
      non_standard_format: false,
      format_label: '',
      link_only: true,
      // modules/reviews/ already rendered this exact page successfully;
      // re-rendering it here to confirm what it just confirmed would spend a
      // second Puppeteer launch for nothing.
      verification: 'unchecked',
    })
  }

  return results
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

export interface PriceFetchOptions {
  /** Product pages modules/reviews/ already confirmed carry this wine —
   * supplied by the router from review_data (CLAUDE.md §5: modules
   * communicate through the router, never by importing each other). */
  confirmedProductPages?: ConfirmedProductPage[]
}

export async function fetchPriceData(
  wine: WineEntry,
  opts: PriceFetchOptions = {}
): Promise<PriceData | null> {
  const apiKey = process.env.OPENAI_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!apiKey || !serperKey) return null

  const searchQuery = buildSearchQuery(wine)
  if (!searchQuery.trim()) return null
  const linkQuery = buildLinkQuery(wine)

  // Step 1 — Serper query: discover retailer URLs + prices (K&L excluded — see querySerper)
  const { retailers: baseResults, klItemSeen } = await querySerper(
    searchQuery,
    RETAILER_CONFIG,
    serperKey,
    {
      producer: wine.producer ?? '',
      denomination: wine.denomination ?? '',
      vintage: wine.vintage ?? null,
      cuvee: wine.cuvee,
      vineyard: wine.vineyard,
    },
    linkQuery
  )

  // Step 2 — Puppeteer pass: render each retailer's live search page and drop
  // any retailer whose search doesn't actually surface a result today. See
  // verifyStillListed — this is what keeps a stale Serper/Google Shopping
  // price from being shown for a wine a retailer's own site no longer lists.
  // Skipped entirely when baseResults is empty rather than launching a
  // Puppeteer browser for nothing.
  const verified = baseResults.length
    ? (await Promise.all(baseResults.map(r => verifyStillListed(r, wine.producer)))).filter(
        (r): r is RetailerResult => r !== null
      )
    : []

  // Retailers whose product page modules/reviews/ already confirmed, for
  // shops this run's Serper pass didn't surface — see confirmedPageResults.
  const confirmed = confirmedPageResults(opts.confirmedProductPages ?? [], verified)

  // K&L's link-only entry, offered only when there is a reason to (Phase
  // 9.1) — see buildKlLinkOnlyResult.
  const klLink = klItemSeen ? buildKlLinkOnlyResult(wine) : null

  // One entry per retailer. The K&L link has to be deduplicated against the
  // confirmed pages too, not just against the Serper results: modules/reviews/
  // searches K&L like any other configured retailer and often *finds* a
  // product page there (Serper's organic index is not blocked — only the
  // render is), so the cross-feed contributes a 'kl' entry which the
  // always-appended link then duplicated. Live-confirmed on the 2026-08-05
  // re-run: Grand Village and Gour de Chaulé each came back with K&L twice.
  // The confirmed product page wins — it points at the actual product rather
  // than a search for it.
  const allRetailers: RetailerResult[] = []
  const seenSlugs = new Set<string>()
  for (const r of [...verified, ...confirmed, ...(klLink ? [klLink] : [])]) {
    if (seenSlugs.has(r.slug)) continue
    seenSlugs.add(r.slug)
    allRetailers.push(r)
  }

  // Reachable again now that nothing is appended unconditionally: an empty
  // PriceData with a fetched_at timestamp is "attempted and found nothing",
  // which the UI must be able to tell apart from "never attempted" (null).
  if (allRetailers.length === 0) return emptyPriceData()
  return aggregatePriceData(allRetailers)
}
