import OpenAI from 'openai'
import type { WineEntry, ReviewProbeLogEntry } from '@shared/types'
import { RETAILER_CONFIG, type RetailerConfig } from '@shared/config/retailers.config'
import {
  findProductPageDetailed,
  findFallbackProductPage,
  findMerchantProductPage,
  isUnrenderableDomain,
} from './find-product-page'
import type { WineIdentity } from './find-product-page'
import { identityOf, extractVintage, type MatchVerdict } from '@shared/utils/wine-match'
import { isExactBottling, type BottlingDifference, type BottlingWine } from '@shared/utils/bottling-difference'
import { buildReviewLadder, reviewBottlingDifference, vintageDelta, SIMILAR_VINTAGE_YEARS } from '@shared/utils/review-ladder'
import { nearestOtherVintageLink } from './other-vintage-link'
import { renderPageHtml } from './puppeteer-extract'
import { extractCandidateText } from './keyword-window'
import { extractFromRenderedHtml } from './gpt-extract'
import type { ReviewResult, GptPageExtraction } from './types'
import { mapWithConcurrency } from '@shared/utils/concurrency'
import { recordAvoidedCalls } from '@shared/utils/serper-client'
import { findProbeEntry, shouldSkipProbedRetailer } from './probe-log'

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
  return (await renderExtractWithHtml(openai, url))?.extraction ?? null
}

/** As renderAndExtract, keeping the rendered page: the page's own links to
 * other vintages are read from it (Phase 12.2 D12) without a second render. */
async function renderExtractWithHtml(openai: OpenAI, url: string) {
  const html = await renderPageHtml(url)
  if (!html) return null
  const candidateText = extractCandidateText(html)
  const extraction = await extractFromRenderedHtml(openai, candidateText, url)
  return extraction ? { extraction, html } : null
}

/** Candidates from a single open-web query worth spending a render+extract
 * on, in rank order (Phase 9.3). pickBestCandidate (find-product-page.ts)
 * already scores every organic result from the one Serper query that was
 * paid for; discarding everything but the top pick meant a wine whose
 * best-matched page simply didn't cite a score came back empty even when the
 * same response held another plausible page that was never looked at —
 * confirmed live for Olivier Leflaive's Bourgogne (corkerywine.com matched
 * but had no citable score; the same response also carried a Wine Enthusiast
 * page for the identical bottling). Zero extra Serper cost either way — it's
 * the same paid-for result set — but each extra candidate tried is one more
 * Puppeteer render + GPT-4o call, so this stays capped at 2 and only ever
 * runs in the open-web passes below, which are themselves reached only once
 * every configured retailer has already come up empty. */
const CANDIDATE_TRY_LIMIT = 2

/** Walks candidates in rank order, rendering and extracting each, and
 * returns the first with a nonempty critic_scores. Falls back to the
 * top-ranked candidate's own extraction (even with no score) when none of
 * the tried candidates cite one — a page with price data but no critic score
 * was always still worth storing, and this must not regress that. */
async function extractBestCandidate(
  openai: OpenAI,
  candidates: Array<{ url: string; match: MatchVerdict }>
): Promise<{ url: string; match: MatchVerdict; extraction: GptPageExtraction } | null> {
  let firstExtracted: { url: string; match: MatchVerdict; extraction: GptPageExtraction } | null = null
  for (const candidate of candidates.slice(0, CANDIDATE_TRY_LIMIT)) {
    const extraction = await renderAndExtract(openai, candidate.url)
    if (!extraction) continue
    if (extraction.critic_scores.length > 0) return { url: candidate.url, match: candidate.match, extraction }
    firstExtracted ??= { url: candidate.url, match: candidate.match, extraction }
  }
  return firstExtracted
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
  serperKey: string,
  attemptedDomains: string[]
): Promise<ReviewResult | null> {
  const outcome = await findFallbackProductPage(identity, serperKey, { attemptedDomains })
  if (outcome.candidates.length === 0) return null

  const picked = await extractBestCandidate(openai, outcome.candidates)
  if (!picked) return null

  const { slug, name } = labelFromUrl(picked.url)
  return {
    slug,
    name,
    product_url: picked.url,
    critic_scores: picked.extraction.critic_scores,
    fetched_at: new Date().toISOString(),
    source: 'fallback',
    ...vintageFields(verdictFromPage(picked.match, picked.extraction.vintage, identity.vintage)),
    page_price: picked.extraction.price,
    page_bottling: picked.extraction.bottling ?? null,
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
  serperKey: string,
  attemptedDomains: string[]
): Promise<ReviewResult[]> {
  const configuredSlugs = new Set(RETAILER_CONFIG.map(r => r.slug))
  const candidates = merchants
    .filter(m => !configuredSlugs.has(m.slug))
    .slice(0, MERCHANT_PROBE_LIMIT)

  const results = await mapWithConcurrency(
    candidates,
    SERPER_CONCURRENCY,
    async (merchant): Promise<ReviewResult | null> => {
      const outcome = await findMerchantProductPage(identity, merchant.name, serperKey, { attemptedDomains })
      if (outcome.candidates.length === 0) return null

      const picked = await extractBestCandidate(openai, outcome.candidates)
      if (!picked) return null

      const { slug, name } = labelFromUrl(picked.url)
      return {
        slug,
        name,
        product_url: picked.url,
        critic_scores: picked.extraction.critic_scores,
        fetched_at: new Date().toISOString(),
        // Reached by an open query rather than a site:-restricted search of
        // a vetted domain — 'fallback', same as the open-web pass.
        source: 'fallback',
        ...vintageFields(verdictFromPage(picked.match, picked.extraction.vintage, identity.vintage)),
        page_price: picked.extraction.price,
        page_bottling: picked.extraction.bottling ?? null,
      }
    }
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
 * renderable configured retailer, independently — one retailer failing (no
 * match, render timeout, no score-citation pattern plus a genuinely empty
 * fallback, no attributed score) never blocks another. K&L is expected to
 * always fail here (bot-blocked at the product-page render, not just its
 * search page — see build-phases.md Phase 7), so it is not searched at all.
 *
 * Phase 14 shape:
 * - **Stage A:** every configured retailer at once through a bounded pool
 *   (`reviewSearchConcurrency`), primary shops first. `opts.progress` is told
 *   as each finishes, so the caller can save and show it at once.
 * - **Stage B:** only when Stage A left no Tier 1 result (the exact wine, same
 *   vintage, from a trusted critic: `buildReviewLadder`). The merchants the
 *   price module found and the open web are searched side by side. They are
 *   unvetted and likelier to return the wrong page, which is why they are
 *   gated rather than always on.
 * - **Last rungs:** pages of a different bottling are read only when no page
 *   of the exact wine gave a score (Phase 12.2).
 * - `tier: 'primary'` (clients from before Phase 14) stops after Stage A over
 *   the primary shops. `resume` carries on an interrupted run. `isCancelled`
 *   stops new work.
 *
 * Returns null — never an empty array — when the search could not run (a key
 * missing, or every request failed), so a transient failure is not stored as a
 * finding. Otherwise an array: empty covers "no query to run" and "nothing
 * found anywhere" alike, since neither is an error here (CLAUDE.md §5 —
 * modules degrade gracefully, never throw uncaught errors).
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
  /** Phase 9.2 (WI-5) — this wine's stored probe history. A configured
   * retailer whose most recent entry is a still-fresh zero_results is
   * skipped rather than re-searched. See probe-log.ts for exactly which
   * stages qualify — request_failed never does. */
  existingProbeLog?: ReviewProbeLogEntry[]
  /** Phase 9.2 (WI-5) — when provided, one entry per retailer actually
   * queried in the configured passes (primary + extended) is pushed here, so
   * the caller can persist an updated log. Not part of the return value:
   * fetchReviewData's return stays ReviewResult[] | null so every existing
   * caller and test keeps working unchanged. */
  probeLogSink?: ReviewProbeLogEntry[]
  /** Phase 9.4 (WI-3) — 'primary' runs only the primary retailer tier and
   * returns, whether or not it found a score: the extended tier, the
   * discovered-merchant probes, and the open-web fallback are never reached.
   * Defaults to 'full' (today's behaviour) so WineCard and WineDetailModal's
   * existing buttons are unchanged. */
  tier?: 'primary' | 'full'
  /** Phase 14 (WI-2) — told as the search goes, so the caller can save each
   * result the moment it exists instead of when the slowest stage ends. A
   * callback that throws never stops the search. */
  progress?: ReviewProgress
  /** Phase 14 (WI-1/WI-2) — asked before each new shop and before Stage B. A
   * search whose wine was discarded or re-identified stops launching work (a
   * request already out cannot be recalled) and returns what it has. */
  isCancelled?: () => boolean
  /** Phase 14 (WI-3) — carry on an interrupted run instead of starting over.
   * A shop probed since `since` (and not `request_failed`) is not searched
   * again; `priorResults` are what that run had already saved, so Stage B's
   * Tier 1 test and the returned array see them. */
  resume?: { since: string; priorResults: ReviewResult[] }
}

/** What a search reports as it goes (Phase 14, WI-2). */
export interface ReviewProgress {
  /** Stage A is about to run. `shopsTotal` is every shop the run covers;
   * `shopsSettled` of those need no search now (a fresh negative probe, or a
   * resumed run that already did them). */
  onPlan?(plan: { shopsTotal: number; shopsSettled: number }): void
  /** One configured shop finished: its page (null when it had none) and the
   * probe-log entry recording how it went. */
  onShop?(event: { slug: string; result: ReviewResult | null; probe: ReviewProbeLogEntry | undefined }): void
  /** Stage B (merchant probes and open web) is starting, or the last-rung
   * reads of a different bottling are. */
  onStage?(stage: 'merchants' | 'finishing'): void
  /** A result from outside Stage A: a merchant, the open web, or a last-rung read. */
  onExtra?(result: ReviewResult): void
}

/** Merchants probed per wine in the discovered-retailer pass. Each costs a
 * Serper call, a Puppeteer render and a GPT-4o call, and price/ can return
 * up to eight retailers. */
const MERCHANT_PROBE_LIMIT = 3

/** Outbound Serper requests in flight at once, per wine. Chosen low
 * deliberately: the cost of being slow is seconds, the cost of being rate
 * limited is a wine silently losing its data (see mapWithConcurrency). */
const SERPER_CONCURRENCY = 3

/**
 * Configured shops searched at once in Stage A (Phase 14, WI-2). Replaces the
 * 3 that bounded the old primary pass, because Stage A now covers every shop
 * and the answer should arrive in seconds. Still bounded: an unbounded burst
 * is how 8 of 14 wines lost their data on 2026-08-05 (mapWithConcurrency), and
 * Chromium stays capped separately by RENDER_CONCURRENCY. The default is
 * provisional until WI-0 measures 3, 6 and 8 on staging; the variable is how
 * that spike sets it without a deploy.
 */
const DEFAULT_REVIEW_SEARCH_CONCURRENCY = 6
export function reviewSearchConcurrency(): number {
  const n = Number(process.env.REVIEW_SEARCH_CONCURRENCY)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_REVIEW_SEARCH_CONCURRENCY
}

/**
 * What a skipped retailer is assumed to have cost, for the avoided-call
 * figure only (Phase 9.2).
 *
 * buildQueryVariants issues between one and four queries depending on the
 * wine's fields and on how many come back empty, so the true figure is only
 * knowable by spending it. Three is the typical middle of that range. This
 * feeds `avoided` in the usage report and never `attempts` — it is an
 * estimate of money not spent, and is labelled as one.
 */
const ESTIMATED_VARIANTS_PER_RETAILER = 3

/** Pages of a different bottling read at the last rung of the ladder (T3), per fetch. */
const T3_READ_LIMIT = 3

/** Other-vintage links followed per fetch (Phase 12.2 D12). */
const MAX_VINTAGE_LINK_FOLLOWS = 2

type ReviewTier = RetailerConfig['reviewTier']

export async function fetchReviewData(
  wine: WineEntry,
  opts: ReviewFetchOptions = {}
): Promise<ReviewResult[] | null> {
  const serperKey = process.env.SERPER_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  // Null means "could not search" — the caller must write nothing. An empty
  // array means "searched, found nothing", which is a real finding and safe
  // to store. Collapsing the two is how a transient Serper failure came to
  // erase good review_data on the 2026-08-05 batch run: every call returned
  // HTTP 200 with an empty array in under a second, and the route stored it.
  if (!serperKey || !openaiKey) return null
  if (!wine.producer && !wine.denomination) return []

  const identity: BottlingWine = {
    ...identityOf(wine),
    wine_color: wine.wine_color,
    region: wine.region,
    grape_varieties: wine.grape_varieties,
    bottling_plain: wine.bottling_plain,
  }
  const openai = new OpenAI({ apiKey: openaiKey })

  // Counted so a run that found nothing *because it could not search* can be
  // told apart from one that searched and genuinely found nothing.
  let requestFailures = 0

  // Retailers whose product pages this pipeline can never read (Phase 9.2).
  // UNRENDERABLE_DOMAINS already existed but was consulted only in the
  // fallback passes, so the configured loop still spent a full variant
  // ladder on K&L for every wine before a render that has been known to be
  // bot-blocked since Phase 7 — a guaranteed-empty result, paid for since the
  // feature shipped. They stay in RETAILER_CONFIG and in attemptedDomains
  // below: the fallback passes must still know K&L was never worth trying.
  const renderable = RETAILER_CONFIG.filter(r => !isUnrenderableDomain(r.domain))
  for (const skipped of RETAILER_CONFIG.filter(r => isUnrenderableDomain(r.domain))) {
    recordAvoidedCalls(`reviews:skipped:unrenderable:${skipped.slug}`, ESTIMATED_VARIANTS_PER_RETAILER)
  }

  // Retailers a previous run already learned nothing about this bottling
  // (Phase 9.2, WI-5). Skip on a fresh zero_results only — see probe-log.ts
  // for why no_relevant_match and request_failed are never skipped here.
  const searchable = renderable.filter(
    r => !shouldSkipProbedRetailer(findProbeEntry(opts.existingProbeLog, r.slug))
  )
  for (const skipped of renderable.filter(r =>
    shouldSkipProbedRetailer(findProbeEntry(opts.existingProbeLog, r.slug))
  )) {
    recordAvoidedCalls(`reviews:skipped:negative-probe:${skipped.slug}`, ESTIMATED_VARIANTS_PER_RETAILER)
  }

  /**
   * One retailer, searched and extracted. Extracted as a named function
   * (Phase 9.2) because the primary and extended passes below both call it,
   * and this file has a documented history of the same logic drifting between
   * copies (see @shared/utils/wine-match.ts's header).
   */
  // Re-bound with an explicit type: the two passes below are hoisted function
  // declarations, which do not inherit the `if (!serperKey) return null`
  // narrowing above.
  const apiKey: string = serperKey

  // Pages of a different bottling, held back by sourceFromRetailer (Phase 12.2).
  const deferred: Array<{ retailer: RetailerConfig; url: string; match: MatchVerdict; difference: BottlingDifference }> = []
  // Links to another vintage followed in this fetch (D12): one local render + one extraction each.
  let followBudget = MAX_VINTAGE_LINK_FOLLOWS
  // The probe entry each shop wrote this run, so Stage A can hand it to the caller with the shop's result.
  const probeBySlug = new Map<string, ReviewProbeLogEntry>()
  /** Runs a progress callback; one that throws must never stop the search. */
  const notify = (fn: () => void) => {
    try {
      fn()
    } catch (err) {
      console.error('[reviews] progress callback failed:', err)
    }
  }
  const cancelled = () => opts.isCancelled?.() === true

  async function sourceFromRetailer(
    retailer: RetailerConfig,
    tier: ReviewTier
  ): Promise<ReviewResult | null> {
    const outcome = await findProductPageDetailed(
      identity,
      retailer,
      apiKey,
      `reviews:${tier}:${retailer.slug}`
    )
    if (outcome.stage === 'request_failed') requestFailures += 1

    // Recorded regardless of outcome — 'found' and 'request_failed' are as
    // much a fact about this run as 'zero_results' is (Phase 9.2, WI-5). Only
    // the configured passes write here: a fallback/discovered-merchant result
    // isn't a RETAILER_CONFIG entry, and the probe log's question is
    // specifically "does this known shop carry this bottling".
    const probe: ReviewProbeLogEntry = {
      slug: retailer.slug,
      domain: retailer.domain,
      stage: outcome.stage,
      variants_tried: outcome.variantsTried,
      probed_at: new Date().toISOString(),
    }
    probeBySlug.set(retailer.slug, probe)
    opts.probeLogSink?.push(probe)

    if (!outcome.url || !outcome.match) return null

    // Narrow first (Phase 12.2 D9). The best page this retailer offered names
    // a different bottling than the wine (an extra or a missing modifier), so
    // it is held back: a render and an extraction are spent on it only if no
    // page of the exact wine yields a score anywhere (see the end of this
    // function). Exact-bottling candidates sort first, so this retailer's best
    // exact page is always read before this applies.
    const bestDifference = outcome.candidates[0]?.difference
    if (bestDifference && !isExactBottling(bestDifference)) {
      deferred.push({ retailer, url: outcome.url, match: outcome.match, difference: bestDifference })
      return null
    }

    const rendered = await renderExtractWithHtml(openai, outcome.url)
    if (!rendered) return null
    let { extraction } = rendered
    let productUrl = outcome.url
    let match = outcome.match

    // The page is a few years off: follow its own link to the vintage we want
    // (D12) — one render, no Serper call. Only for the exact wine, and capped
    // per fetch.
    if (identity.vintage != null && extraction.vintage != null && extraction.vintage !== identity.vintage && followBudget > 0) {
      const link = nearestOtherVintageLink(rendered.html, outcome.url, identity.vintage)
      if (link) {
        followBudget -= 1
        const followed = await renderExtractWithHtml(openai, link)
        const followedVintage = followed?.extraction.vintage ?? extractVintage(link)
        if (followed && followed.extraction.critic_scores.length > 0 && followedVintage != null &&
            Math.abs(followedVintage - identity.vintage) < Math.abs(extraction.vintage - identity.vintage)) {
          extraction = { ...followed.extraction, vintage: followedVintage }
          productUrl = link
          match = outcome.match
        }
      }
    }

    return {
      slug: retailer.slug,
      name: retailer.name,
      product_url: productUrl,
      critic_scores: extraction.critic_scores,
      fetched_at: new Date().toISOString(),
      source: 'configured',
      ...vintageFields(verdictFromPage(match, extraction.vintage, identity.vintage)),
      page_price: extraction.price,
      page_bottling: extraction.bottling ?? null,
    }
  }

  const results: ReviewResult[] = [...(opts.resume?.priorResults ?? [])]
  const hasTier1 = () => buildReviewLadder(results, identity).tier === '1'

  // Stage A (Phase 14, WI-2). Every renderable configured shop, primary shops
  // first so the first scores arrive early, through one bounded pool. This
  // replaces "primary, then extended only if nothing scored", which let one
  // off-vintage score end the search (F8) and put the wider net behind a
  // click (CLAUDE.md §15, amended 2026-11-22). A tier=primary request (stale
  // clients, D8) still covers the primary shops only.
  const wantedTier = (r: RetailerConfig) =>
    r.reviewTier === 'primary' || (opts.tier !== 'primary' && r.reviewTier === 'extended')
  const tierShops = [
    ...renderable.filter(r => r.reviewTier === 'primary'),
    ...renderable.filter(r => r.reviewTier === 'extended'),
  ].filter(wantedTier)
  const searchableSlugs = new Set(searchable.map(r => r.slug))

  // A resumed run does not repeat a shop it already finished. request_failed
  // is never "finished": the request did not run, so it is asked again.
  const resumeSince = opts.resume ? Date.parse(opts.resume.since) : Number.NaN
  const settledByResume = (r: RetailerConfig): boolean => {
    if (Number.isNaN(resumeSince)) return false
    const entry = findProbeEntry(opts.existingProbeLog, r.slug)
    return !!entry && entry.stage !== 'request_failed' && Date.parse(entry.probed_at) >= resumeSince
  }
  const toSearch = tierShops.filter(r => {
    if (!searchableSlugs.has(r.slug)) return false
    if (!settledByResume(r)) return true
    recordAvoidedCalls(`reviews:skipped:resume:${r.slug}`, ESTIMATED_VARIANTS_PER_RETAILER)
    return false
  })
  notify(() => opts.progress?.onPlan?.({ shopsTotal: tierShops.length, shopsSettled: tierShops.length - toSearch.length }))

  const shopResults = await mapWithConcurrency(toSearch, reviewSearchConcurrency(), async retailer => {
    if (cancelled()) return null
    const result = await sourceFromRetailer(retailer, retailer.reviewTier)
    notify(() => opts.progress?.onShop?.({ slug: retailer.slug, result, probe: probeBySlug.get(retailer.slug) }))
    return result
  })
  results.push(...shopResults.filter((r): r is ReviewResult => r !== null))

  /**
   * "This run has found nothing worth having" for the tier=primary path only
   * (Phase 9.2). The full search no longer escalates on "any score at all":
   * Stage B is gated on Tier 1 (`hasTier1`), the exact wine in the same
   * vintage from a trusted critic.
   */
  const foundNoScore = () => !results.some(r => r.critic_scores.length > 0)

  // Phase 9.4 (WI-3) — a tier=primary request stops after the primary shops,
  // whether or not they found a score. Kept for clients from before Phase 14.
  // The avoided-call label is only recorded when the boundary changed the
  // outcome (nothing found), so a cheap run is not credited to tiering.
  if (opts.tier === 'primary') {
    if (foundNoScore()) {
      for (const skipped of searchable.filter(r => r.reviewTier === 'extended')) {
        recordAvoidedCalls(`reviews:skipped:tier-primary:${skipped.slug}`, ESTIMATED_VARIANTS_PER_RETAILER)
      }
      recordAvoidedCalls(
        'reviews:skipped:tier-primary:discovered-merchants',
        ESTIMATED_VARIANTS_PER_RETAILER * MERCHANT_PROBE_LIMIT
      )
      recordAvoidedCalls('reviews:skipped:tier-primary:open-web-fallback', ESTIMATED_VARIANTS_PER_RETAILER)
    }
    if (results.length === 0 && requestFailures > 0) return null
    return results
  }

  // Every configured retailer domain, attempted or not — the open passes
  // below must not spend a render on one this run has already exhausted.
  // Bessin-Tremblay and Dureuil-Janthial both produced
  // `fallback-shop-klwines-com` pointing at the identical URL that had just
  // returned zero as a configured retailer.
  const attemptedDomains = RETAILER_CONFIG.map(r => r.domain)

  // Stage B (Phase 14, WI-2): the merchants modules/price/ found and the open
  // web are unvetted sources — likelier to return the wrong page, dearer in
  // GPT-4o per hit — so they run, automatically, only when Stage A left no
  // Tier 1 result. The two run side by side: each needs only the configured
  // domains above to avoid repeating a shop, which is known up front. A page
  // both reach is kept once.
  if (!cancelled() && !hasTier1()) {
    notify(() => opts.progress?.onStage?.('merchants'))
    const keep = (found: ReviewResult[]) => {
      for (const r of found) {
        if (results.some(x => x.slug === r.slug)) continue
        results.push(r)
        notify(() => opts.progress?.onExtra?.(r))
      }
    }
    await Promise.all([
      fetchDiscoveredMerchantReviews(identity, opts.discoveredRetailers ?? [], openai, serperKey, attemptedDomains).then(keep),
      fetchFallbackReview(identity, openai, serperKey, attemptedDomains).then(r => keep(r ? [r] : [])),
    ])
  }

  // The last rungs (Phase 12.2 D9, T3/T4). No page of the exact wine yielded
  // a score anywhere, so read the pages of a different bottling that were held
  // back — same vintage first, then the nearest within ±3 years — and stop at
  // the first that gives a score. Each is one local render and one extraction;
  // no Serper call (the candidates came from queries already paid for).
  const exactScoreFound = () =>
    results.some(r => r.critic_scores.length > 0 && isExactBottling(reviewBottlingDifference(r, identity)))
  if (!exactScoreFound() && deferred.length > 0) {
    const ranked = deferred
      .map(d => ({ d, delta: vintageDelta(d.match.candidateVintage, identity.vintage) }))
      .filter((x): x is { d: (typeof deferred)[number]; delta: number } => x.delta !== null && x.delta <= SIMILAR_VINTAGE_YEARS)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, T3_READ_LIMIT)
    if (ranked.length > 0 && !cancelled()) notify(() => opts.progress?.onStage?.('finishing'))
    for (const { d } of ranked) {
      if (cancelled()) break
      const extraction = await renderAndExtract(openai, d.url)
      if (!extraction) continue
      const read: ReviewResult = {
        slug: d.retailer.slug,
        name: d.retailer.name,
        product_url: d.url,
        critic_scores: extraction.critic_scores,
        fetched_at: new Date().toISOString(),
        source: 'configured',
        ...vintageFields(verdictFromPage(d.match, extraction.vintage, identity.vintage)),
        page_price: extraction.price,
        page_bottling: extraction.bottling ?? null,
      }
      results.push(read)
      notify(() => opts.progress?.onExtra?.(read))
      if (extraction.critic_scores.length > 0) break
    }
  }

  // Nothing found, and at least one search never actually ran. Refuse to
  // report that as "found nothing" — see the null contract above.
  if (results.length === 0 && requestFailures > 0) return null

  return results
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
