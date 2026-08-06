import OpenAI from 'openai'
import type { WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { findProductPageDetailed, findFallbackProductPage, findMerchantProductPage } from './find-product-page'
import type { WineIdentity } from './find-product-page'
import type { MatchVerdict } from '@shared/utils/wine-match'
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
 * Re-judges a page against the vintage the page itself states (Phase 9.1).
 *
 * `gpt-extract.ts` has always returned `{ price, url, vintage, critic_scores }`
 * and `fetchReviewData` read only `critic_scores`, dropping the rest on the
 * floor — the one field that would have caught every wrong-vintage row in the
 * 2026-08-04 batch was being computed and discarded.
 *
 * The Step 1 verdict was formed from a search-result title, which is a guess;
 * the rendered page is evidence. When the page states a vintage, that wins.
 * When it doesn't, the Step 1 verdict stands rather than being downgraded to
 * unknown — a silent page is not a retraction of what the title said.
 *
 * Only the vintage dimension is revised. Producer, denomination and bottling
 * keep their Step 1 verdicts, which were judged against the full title,
 * snippet and URL; re-running the whole matcher against the URL alone would
 * downgrade a confirmed producer to a mismatch for any retailer whose product
 * slugs are opaque ids (`/products/details/1557135`).
 */
function verdictFromPage(
  step1: MatchVerdict,
  pageVintage: number | null,
  wineVintage: number | null
): MatchVerdict {
  // A vintage on the page is not our vintage when the wine has none — an NV
  // Champagne's disgorgement or base year must not be read as a match.
  if (pageVintage === null || wineVintage === null) return step1

  const vintageGap = Math.abs(pageVintage - wineVintage)
  return {
    ...step1,
    vintage: vintageGap === 0 ? 'match' : 'mismatch',
    candidateVintage: pageVintage,
    vintageGap,
  }
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
  if (!outcome.url || !outcome.match) return null

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
    ...vintageFields(verdictFromPage(outcome.match, extraction.vintage, identity.vintage)),
  }
}

/**
 * Searches merchants modules/price/ discovered but RETAILER_CONFIG doesn't
 * cover (Phase 9.1). Runs only in the "found nothing" branch, and before the
 * blind open-web pass — a shop the price module's own relevance-filtered
 * Shopping search surfaced for this wine is a better-aimed guess than an
 * unrestricted query.
 *
 * Capped at MERCHANT_PROBE_LIMIT: each probe is a Serper call plus a
 * Puppeteer render plus a GPT-4o call, and price/ can return up to eight
 * retailers.
 */
async function fetchDiscoveredMerchantReviews(
  identity: WineIdentity,
  merchants: DiscoveredRetailer[],
  openai: OpenAI,
  serperKey: string
): Promise<ReviewResult[]> {
  const configuredSlugs = new Set(RETAILER_CONFIG.map(r => r.slug))
  const candidates = merchants
    .filter(m => !configuredSlugs.has(m.slug))
    .slice(0, MERCHANT_PROBE_LIMIT)

  const results = await Promise.all(
    candidates.map(async (merchant): Promise<ReviewResult | null> => {
      const outcome = await findMerchantProductPage(identity, merchant.name, serperKey)
      if (!outcome.url || !outcome.match) return null

      const extraction = await renderAndExtract(openai, outcome.url)
      if (!extraction) return null

      const { slug, name } = labelFromUrl(outcome.url)
      return {
        slug,
        name,
        product_url: outcome.url,
        critic_scores: extraction.critic_scores,
        fetched_at: new Date().toISOString(),
        // Reached by an open query rather than a site:-restricted search of
        // a vetted domain — 'fallback', same as the open-web pass.
        source: 'fallback',
        ...vintageFields(verdictFromPage(outcome.match, extraction.vintage, identity.vintage)),
      }
    })
  )

  return results.filter((r): r is ReviewResult => r !== null)
}

/** The three Phase 9.1 identity fields every stored ReviewResult carries.
 * Kept in one place so the configured and fallback paths can never drift on
 * what "which wine is this page actually about" means. */
function vintageFields(match: MatchVerdict): Pick<ReviewResult, 'page_vintage' | 'vintage_gap' | 'match'> {
  return { page_vintage: match.candidateVintage, vintage_gap: match.vintageGap, match }
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
/** A retailer modules/price/ found for this wine — supplied by the router
 * from price_data.retailers (CLAUDE.md §5: modules communicate through the
 * router, never by importing each other). Only the display name is usable
 * as a search term: Serper's Shopping response never carries the merchant's
 * own domain. */
export interface DiscoveredRetailer {
  slug: string
  name: string
}

export interface ReviewFetchOptions {
  discoveredRetailers?: DiscoveredRetailer[]
}

/** Merchants probed per wine in the discovered-retailer pass. Each costs a
 * Serper call, a Puppeteer render and a GPT-4o call, and price/ can return
 * up to eight retailers. */
const MERCHANT_PROBE_LIMIT = 3

export async function fetchReviewData(
  wine: WineEntry,
  opts: ReviewFetchOptions = {}
): Promise<ReviewResult[]> {
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
      const outcome = await findProductPageDetailed(identity, retailer, serperKey)
      if (!outcome.url || !outcome.match) return null

      const extraction = await renderAndExtract(openai, outcome.url)
      if (!extraction) return null

      return {
        slug: retailer.slug,
        name: retailer.name,
        product_url: outcome.url,
        critic_scores: extraction.critic_scores,
        fetched_at: new Date().toISOString(),
        source: 'configured',
        ...vintageFields(verdictFromPage(outcome.match, extraction.vintage, identity.vintage)),
      }
    })
  )

  const results = configuredResults.filter((r): r is ReviewResult => r !== null)

  // Nothing from any configured retailer. Try the shops modules/price/ found
  // for this wine first — a merchant its Shopping search actually surfaced is
  // better aimed than a blind open-web query — then fall back to that query.
  if (!results.some(r => r.critic_scores.length > 0)) {
    const discovered = await fetchDiscoveredMerchantReviews(
      identity,
      opts.discoveredRetailers ?? [],
      openai,
      serperKey
    )
    results.push(...discovered)
  }

  if (!results.some(r => r.critic_scores.length > 0)) {
    const fallback = await fetchFallbackReview(identity, openai, serperKey)
    if (fallback) results.push(fallback)
  }

  return results
}
