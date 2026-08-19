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
import type { MatchVerdict } from '@shared/utils/wine-match'
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
  const html = await renderPageHtml(url)
  if (!html) return null
  const candidateText = extractCandidateText(html)
  return extractFromRenderedHtml(openai, candidateText, url)
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

  const identity: WineIdentity = {
    producer: wine.producer ?? '',
    denomination: wine.denomination ?? '',
    vintage: wine.vintage ?? null,
    cuvee: wine.cuvee,
    vineyard: wine.vineyard,
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
    opts.probeLogSink?.push({
      slug: retailer.slug,
      domain: retailer.domain,
      stage: outcome.stage,
      variants_tried: outcome.variantsTried,
      probed_at: new Date().toISOString(),
    })

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
      page_price: extraction.price,
    }
  }

  // Bounded, not Promise.all (2026-08-05). Twelve retailers × up to four
  // Serper queries each is a burst large enough to get rate limited, and a
  // rate-limited query is indistinguishable from "this shop doesn't carry
  // it" — so the failure mode is silent data loss, not a visible error.
  async function runPass(retailers: RetailerConfig[], tier: ReviewTier): Promise<ReviewResult[]> {
    const passResults = await mapWithConcurrency(retailers, SERPER_CONCURRENCY, r =>
      sourceFromRetailer(r, tier)
    )
    return passResults.filter((r): r is ReviewResult => r !== null)
  }

  const results = await runPass(
    searchable.filter(r => r.reviewTier === 'primary'),
    'primary'
  )

  /**
   * "This run has found nothing worth having" — one definition, shared by
   * every escalation below (Phase 9.2, CLAUDE.md §15 "prefer escalation over
   * breadth"). A retailer whose page rendered fine but cited no score counts
   * as nothing: a page without a critic score is not what any of these passes
   * are being paid to find.
   */
  const foundNoScore = () => !results.some(r => r.critic_scores.length > 0)

  // Extended tier — fully trusted retailers, just not paid for up front. Only
  // reached when the primary pass came back without a single critic score.
  const extended = searchable.filter(r => r.reviewTier === 'extended')

  // Phase 9.4 (WI-3) — bounded to the primary tier. Stops here regardless of
  // foundNoScore(): extended, discovered-merchant, and open-web escalation
  // are a click away (POST /:id/fetch-reviews?tier=full), never automatic.
  // The avoided-call label is only recorded when the tier boundary actually
  // changed the outcome (foundNoScore() true) — when primary already found a
  // score, extended would have been skipped in 'full' mode too, and
  // attributing that skip to tiering would misreport why it was cheap.
  if (opts.tier === 'primary') {
    if (foundNoScore()) {
      for (const skipped of extended) {
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

  if (foundNoScore()) {
    results.push(...(await runPass(extended, 'extended')))
  } else {
    for (const skipped of extended) {
      recordAvoidedCalls(`reviews:skipped:extended:${skipped.slug}`, ESTIMATED_VARIANTS_PER_RETAILER)
    }
  }

  // Every configured retailer domain, attempted or not — the open passes
  // below must not spend a render on one this run has already exhausted.
  // Bessin-Tremblay and Dureuil-Janthial both produced
  // `fallback-shop-klwines-com` pointing at the identical URL that had just
  // returned zero as a configured retailer.
  const attemptedDomains = RETAILER_CONFIG.map(r => r.domain)

  // Nothing from any configured retailer. Try the shops modules/price/ found
  // for this wine first — a merchant its Shopping search actually surfaced is
  // better aimed than a blind open-web query — then fall back to that query.
  if (foundNoScore()) {
    const discovered = await fetchDiscoveredMerchantReviews(
      identity,
      opts.discoveredRetailers ?? [],
      openai,
      serperKey,
      attemptedDomains
    )
    results.push(...discovered)
  }

  if (foundNoScore()) {
    const attemptedPlusDiscovered = [
      ...attemptedDomains,
      ...results.map(r => hostnameOf(r.product_url)).filter((h): h is string => h !== null),
    ]
    const fallback = await fetchFallbackReview(identity, openai, serperKey, attemptedPlusDiscovered)
    if (fallback) results.push(fallback)
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
