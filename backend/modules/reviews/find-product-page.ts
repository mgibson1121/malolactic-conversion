import type { RetailerConfig } from '@shared/config/retailers.config'
import {
  isRelevantMatch,
  scoreMatch,
  isAcceptableMatch,
  compareByMatchQuality,
  foldDiacritics,
  stripHonorifics,
  type MatchVerdict,
  type WineIdentity,
} from '@shared/utils/wine-match'
import { isDenylistedDomain, isNonProductUrl } from '@shared/config/denylisted-domains'
import { serperFetch } from '@shared/utils/serper-client'

export type { WineIdentity }
// Re-exported for backward compatibility — existing callers/tests import
// isRelevantMatch from here. The implementation now lives in
// @shared/utils/wine-match.ts alongside price/serper-query.ts's identical
// copy — see that file's header for why.
export { isRelevantMatch }

interface SerperOrganicItem {
  title: string
  link: string
  snippet?: string
}

interface SerperOrganicResponse {
  organic?: SerperOrganicItem[]
}

interface QueryOptions {
  includeDistinguishing: boolean
  includeVintage: boolean
  /** Drop leading honorifics ("Domaine", "Château") from the quoted producer
   * phrase. See stripHonorifics and buildQueryVariants. */
  relaxProducer?: boolean
}

/**
 * Builds a site:-restricted, quoted-phrase Serper query. Diacritics are
 * folded before quoting (2026-08-02 fix) — the retailer's own page text
 * frequently doesn't preserve the exact accented characters stored on the
 * wine entry (e.g. "Montée de Tonnerre" vs "Montee de Tonnerre"), and unlike
 * isRelevantMatch's post-fetch comparison (which already normalizes both
 * sides), this literal quoted query was previously sent accented — a
 * needlessly strict exact-match requirement Serper/Google's own indexing
 * doesn't reliably fold on our behalf when several quoted phrases are ANDed
 * together.
 */
function buildQuery(wine: WineIdentity, domain: string, opts: QueryOptions): string {
  const parts = [`site:${domain}`]
  if (wine.producer) {
    const producer = opts.relaxProducer ? stripHonorifics(wine.producer) : wine.producer
    parts.push(`"${foldDiacritics(producer)}"`)
  }
  if (wine.denomination) parts.push(`"${foldDiacritics(wine.denomination)}"`)
  if (opts.includeDistinguishing) {
    if (wine.cuvee) parts.push(`"${foldDiacritics(wine.cuvee)}"`)
    if (wine.vineyard) parts.push(`"${foldDiacritics(wine.vineyard)}"`)
  }
  if (opts.includeVintage && wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}

/**
 * Builds a sequence of progressively broader queries: the full identity
 * first, then — only if that returns literally zero organic results, not
 * just no relevant one — a relaxed retry dropping cuvee/vineyard, then a
 * final retry dropping vintage too. (2026-08-02 fix.) Each additional quoted
 * phrase in the full query is a new way for a real, relevant product page to
 * fail to come back at all if the retailer's page text doesn't contain that
 * exact substring — this was the diagnosed cause of a real miss (Woodland
 * Hills carrying a Fèvre Chablis premier cru whose vineyard name didn't
 * literally appear the way the wine entry stored it), and it got stricter,
 * not more forgiving, when 2026-07-30's cuvee/vineyard relevance fix added a
 * fourth required quoted phrase without a fallback. Deduplicated — a wine
 * with no cuvee/vineyard/vintage set produces a single variant, same as
 * before this change.
 *
 * The honorific-stripped producer variant (Phase 9.1) goes *second*, not
 * last. Producer and denomination were never relaxed at all before, which
 * cost real coverage: `"Domaine Jean-Marc Vincent"` fails against Morrell's
 * "Jean-Marc Vincent Santenay Rouge 1er Cru Gravieres 2022", and the price
 * module found that exact listing at Morrell in the same run this module
 * found nothing there. Relaxing an honorific is much closer to the original
 * query than dropping the vintage is — it removes a word the retailer
 * probably never wrote, rather than a real identity constraint — so it
 * belongs before the broader relaxations, and only fires when it actually
 * changes the query (the Set dedupe handles producers with no honorific).
 */
function buildQueryVariants(wine: WineIdentity, domain: string): string[] {
  const variants = [
    buildQuery(wine, domain, { includeDistinguishing: true, includeVintage: true }),
    buildQuery(wine, domain, { includeDistinguishing: true, includeVintage: true, relaxProducer: true }),
  ]
  if (wine.cuvee || wine.vineyard) {
    variants.push(buildQuery(wine, domain, { includeDistinguishing: false, includeVintage: true, relaxProducer: true }))
  }
  if (wine.vintage) {
    variants.push(buildQuery(wine, domain, { includeDistinguishing: false, includeVintage: false, relaxProducer: true }))
  }
  return [...new Set(variants)]
}

async function runSerperQuery(
  query: string,
  apiKey: string,
  label: string
): Promise<SerperOrganicItem[] | null> {
  const res = await serperFetch('search', { q: query, gl: 'us' }, apiKey, label)
  if (!res.ok) return null
  const json = (await res.json()) as SerperOrganicResponse
  return json.organic ?? []
}

export type Step1Stage = 'request_failed' | 'zero_results' | 'no_relevant_match' | 'found'

export interface Step1Outcome {
  url: string | null
  stage: Step1Stage
  // Number of query variants actually tried (1–3) — mainly useful for the
  // validate-reviews.ts diagnostic script, to show how often the relaxed-
  // query retry (2026-08-02) is what makes the difference.
  variantsTried: number
  // The verdict the winning candidate was accepted on (Phase 9.1) — null
  // when nothing was accepted. Carried through to the stored ReviewResult so
  // the UI can badge a wrong-vintage page.
  match: MatchVerdict | null
  // Candidates that were considered and turned down, with the verdict that
  // turned them down (Phase 9.1). Populated only on 'no_relevant_match',
  // which is otherwise the least legible outcome in the pipeline: a bare
  // "nothing matched" tells you neither what was on offer nor which
  // dimension disqualified it. This is what turns the next report into a log
  // read — see backend/scripts/validate-reviews.ts.
  rejected: RejectedCandidate[]
}

export interface RejectedCandidate {
  title: string
  url: string
  /** Null when the URL's shape ruled it out before it was ever scored — a
   * PDF, a blog post, an auction page. See isNonProductUrl. */
  verdict: MatchVerdict | null
}

/**
 * Picks the single best candidate out of a Serper result set (Phase 9.1).
 *
 * Replaces `items.find(item => isRelevantMatch(...))`, which took whichever
 * result Serper happened to rank first among those passing a boolean check.
 * That is what made a shop indexing both the 2022 and the 2020 yield the
 * 2020: relevance ranking is Google's notion of "best", not ours. Scoring
 * every candidate and sorting by compareByMatchQuality makes the exact
 * vintage win when one exists, while still yielding the 2020 when it is the
 * only page — vintage ranks, it never rejects (see wine-match.ts).
 *
 * The candidate's own `link` is passed as the url, so a product slug
 * (`/charles-audoin-marsannay-clos-du-roy-2020`) can confirm producer and
 * vintage when the title is a bare "Product Detail". The snippet is passed
 * too, but scoreMatch deliberately ignores it for the producer dimension.
 *
 * Candidates whose URL shape rules out a product page are dropped before
 * scoring (Phase 9.1) — the batch stored a JJ Buckley PDF, a Zachys auction
 * bidding-history page and two retailer blog posts as product pages. See
 * isNonProductUrl.
 */
function pickBestCandidate(
  items: SerperOrganicItem[],
  wine: WineIdentity
): { best: { item: SerperOrganicItem; verdict: MatchVerdict } | null; rejected: RejectedCandidate[] } {
  const acceptable: Array<{ item: SerperOrganicItem; verdict: MatchVerdict }> = []
  const rejected: RejectedCandidate[] = []

  for (const item of items) {
    if (isNonProductUrl(item.link)) {
      rejected.push({ title: item.title, url: item.link, verdict: null })
      continue
    }
    const verdict = scoreMatch({ title: item.title, snippet: item.snippet, url: item.link }, wine)
    if (isAcceptableMatch(verdict)) acceptable.push({ item, verdict })
    else rejected.push({ title: item.title, url: item.link, verdict })
  }

  if (acceptable.length === 0) return { best: null, rejected }
  return {
    best: acceptable.sort((a, b) => compareByMatchQuality(a.verdict, b.verdict))[0],
    rejected,
  }
}

/**
 * Step 1 — finds a single retailer product page via Serper's organic
 * `/search` endpoint with a site:-restricted query. Not the /shopping
 * endpoint (its `link` is always a google.com/search?ibp=oshop aggregator,
 * never a real product URL — see build-phases.md Phase 9), and not by
 * rendering the retailer's own on-site search (unreliable, and blocked by
 * bot detection on at least one configured retailer even where robots.txt
 * permits it — see build-phases.md Phase 7). Makes no request to the
 * retailer's own site.
 *
 * Tries progressively broader query variants (see buildQueryVariants) only
 * when a variant comes back with zero organic results at all — a variant
 * that returns results but none relevant is not retried, since relaxing the
 * query further in that case would risk matching the wrong product rather
 * than finding the right one under a different phrasing. Returns which
 * stage it stopped at, not just the url — see validate-reviews.ts, which is
 * the reason this returns a Step1Outcome rather than collapsing straight to
 * `string | null`: a one-off report used to require re-diagnosing from
 * scratch which of these stages a given wine/retailer failed at; this
 * makes that a log line instead of a live-debugging session.
 */
export async function findProductPageDetailed(
  wine: WineIdentity,
  retailer: RetailerConfig,
  apiKey: string,
  /** Serper accounting tag (Phase 9.2) — the caller supplies which pass this
   * search belongs to, since the same retailer is reachable from more than
   * one. See shared/utils/serper-client.ts. */
  label = `reviews:configured:${retailer.slug}`
): Promise<Step1Outcome> {
  try {
    const variants = buildQueryVariants(wine, retailer.domain)
    let sawAnyResults = false
    let variantsTried = 0
    for (const query of variants) {
      variantsTried += 1
      const items = await runSerperQuery(query, apiKey, label)
      if (items === null) return { url: null, stage: 'request_failed', variantsTried, match: null, rejected: [] }
      if (items.length === 0) continue
      sawAnyResults = true
      const { best, rejected } = pickBestCandidate(items, wine)
      if (best) return { url: best.item.link, stage: 'found', variantsTried, match: best.verdict, rejected: [] }
      return { url: null, stage: 'no_relevant_match', variantsTried, match: null, rejected }
    }
    return {
      url: null,
      stage: sawAnyResults ? 'no_relevant_match' : 'zero_results',
      variantsTried,
      match: null,
      rejected: [],
    }
  } catch {
    return { url: null, stage: 'request_failed', variantsTried: 0, match: null, rejected: [] }
  }
}

/** Thin wrapper over findProductPageDetailed for callers that only need the
 * url (the production fetchReviewData path) — see that function for the
 * stage-aware version used by the validate-reviews.ts diagnostic script. */
export async function findProductPage(
  wine: WineIdentity,
  retailer: RetailerConfig,
  apiKey: string
): Promise<string | null> {
  const outcome = await findProductPageDetailed(wine, retailer, apiKey)
  return outcome.url
}

/**
 * Open-web fallback pass (Phase 7.3, 2026-08-02, specced 2026-07-29 but not
 * actually built until now — see build-phases.md Phase 7.3). Only called by
 * fetchReviewData when every configured retailer (the Step 1 loop above,
 * across all of RETAILER_CONFIG) returned zero critic scores for the wine —
 * mirrors the price module's Pass 1 (preferred retailers) / Pass 2 (open
 * fallback) pattern, which reviews never had.
 *
 * One Serper organic query, no `site:` restriction — the query is
 * deliberately just `"<producer>" "<denomination>" <vintage> review`, not
 * the cuvee/vineyard-aware variants Step 1 uses, matching the original
 * spec's scope; extend this later if the plain query proves too broad in
 * practice. Candidates on a denylisted domain (CellarTracker,
 * WineBerserkers — ToS-prohibited, CLAUDE.md §15) are filtered out before
 * relevance ranking, regardless of what Serper returns. No retry — a single
 * attempt, since this is already the last resort, not the primary path.
 */
export async function findFallbackProductPage(
  wine: WineIdentity,
  apiKey: string,
  opts: OpenQueryOptions = {}
): Promise<Step1Outcome> {
  return runOpenQuery(`${openWebIdentityPhrase(wine)} review`, wine, apiKey, {
    label: 'reviews:open-web',
    ...opts,
  })
}

/**
 * Domains the fallback passes must not spend a render on, beyond the
 * denylist (Phase 9.1).
 *
 * `attemptedDomains` is what stops the fallback re-trying a domain this same
 * run already exhausted: Bessin-Tremblay and Dureuil-Janthial both produced
 * `fallback-shop-klwines-com` pointing at the *identical* URL that had just
 * returned zero scores as a configured retailer — a wasted Serper +
 * Puppeteer + GPT-4o cycle with a guaranteed-empty result.
 */
export interface OpenQueryOptions {
  attemptedDomains?: string[]
  /** Serper accounting tag (Phase 9.2) — see shared/utils/serper-client.ts.
   * findMerchantProductPage is reached from three different passes, which
   * cost very different amounts; one shared label would hide that. */
  label?: string
}

/** Domains known not to render for this pipeline, so a fallback hit on them
 * is a guaranteed-empty cycle. K&L's own site blocks Puppeteer behind a
 * bot-detection challenge at the product-page render, documented since
 * Phase 7 and explicitly not pursued via evasion (CLAUDE.md §15). This is a
 * cost guard, not an access decision — the denylist above is where access
 * decisions live. */
const UNRENDERABLE_DOMAINS = ['klwines.com']

/**
 * Searches the open web for a *named merchant's* page for this wine
 * (Phase 9.1).
 *
 * modules/price/ discovers retailers this module has never heard of — the
 * Shopping endpoint found central-wine-merchants, Wally's and Varmax for
 * Montus while this module, which only ever iterates RETAILER_CONFIG, never
 * looked at any of them. The router feeds those merchant names back here.
 *
 * It has to be an open query with the merchant name as a term rather than a
 * `site:` restriction: Serper's Shopping response gives a merchant display
 * name and a google.com/search?ibp=oshop aggregator link, never the
 * merchant's own domain, so there is no domain to restrict to. That makes
 * this weaker than Step 1's site:-scoped search, which is why results from
 * it are tagged `source: 'fallback'` — the domain reached is not one the
 * developer has vetted.
 */
export async function findMerchantProductPage(
  wine: WineIdentity,
  merchantName: string,
  apiKey: string,
  opts: OpenQueryOptions = {}
): Promise<Step1Outcome> {
  return runOpenQuery(
    `${openWebIdentityPhrase(wine)} "${foldDiacritics(merchantName)}"`,
    wine,
    apiKey,
    { label: 'reviews:merchant-probe', ...opts }
  )
}

/** The quoted producer/denomination/vintage core shared by both open-web
 * queries. Honorific-stripped from the outset — these are last-resort
 * passes, so there is no narrower attempt for a relaxation to undercut, and
 * the open web is even less likely than a retailer to write "Domaine". */
function openWebIdentityPhrase(wine: WineIdentity): string {
  const parts: string[] = []
  if (wine.producer) parts.push(`"${foldDiacritics(stripHonorifics(wine.producer))}"`)
  if (wine.denomination) parts.push(`"${foldDiacritics(wine.denomination)}"`)
  if (wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}

/** One un-restricted Serper organic query, denylist-filtered and graded.
 * No retry — both callers are already last resorts, not the primary path. */
async function runOpenQuery(
  query: string,
  wine: WineIdentity,
  apiKey: string,
  opts: OpenQueryOptions = {}
): Promise<Step1Outcome> {
  const attempted = (opts.attemptedDomains ?? []).map(d => d.toLowerCase().replace(/^www\./, ''))

  try {
    const items = await runSerperQuery(query, apiKey, opts.label ?? 'reviews:open-query')
    if (items === null) {
      return { url: null, stage: 'request_failed', variantsTried: 1, match: null, rejected: [] }
    }

    const allowed = items.filter(item => {
      if (isNonProductUrl(item.link)) return false
      try {
        const host = new URL(item.link).hostname.toLowerCase().replace(/^www\./, '')
        if (isDenylistedDomain(host)) return false
        // Already exhausted this run, or known not to render — either way,
        // spending a render + GPT-4o call here buys a guaranteed empty.
        if (attempted.some(d => host === d || host.endsWith(`.${d}`))) return false
        if (UNRENDERABLE_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return false
        return true
      } catch {
        return false // an unparseable link can't be rendered anyway
      }
    })
    if (allowed.length === 0) {
      return {
        url: null,
        stage: items.length === 0 ? 'zero_results' : 'no_relevant_match',
        variantsTried: 1,
        match: null,
        rejected: [],
      }
    }

    const { best, rejected } = pickBestCandidate(allowed, wine)
    if (best) {
      return { url: best.item.link, stage: 'found', variantsTried: 1, match: best.verdict, rejected: [] }
    }
    return { url: null, stage: 'no_relevant_match', variantsTried: 1, match: null, rejected }
  } catch {
    return { url: null, stage: 'request_failed', variantsTried: 1, match: null, rejected: [] }
  }
}
