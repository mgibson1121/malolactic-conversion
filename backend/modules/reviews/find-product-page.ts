import type { RetailerConfig } from '@shared/config/retailers.config'
import { isRelevantMatch, type WineIdentity } from '@shared/utils/wine-match'
import { isDenylistedDomain } from '@shared/config/denylisted-domains'

export type { WineIdentity }
// Re-exported for backward compatibility — existing callers/tests import
// isRelevantMatch from here. The implementation now lives in
// @shared/utils/wine-match.ts alongside price/serper-query.ts's identical
// copy — see that file's header for why.
export { isRelevantMatch }

const SERPER_ENDPOINT = 'https://google.serper.dev/search'

interface SerperOrganicItem {
  title: string
  link: string
  snippet?: string
}

interface SerperOrganicResponse {
  organic?: SerperOrganicItem[]
}

/** Strips diacritics only (no lowercasing, no punctuation removal) — safe to
 * use inside a quoted Serper phrase, unlike wine-match.ts's normalize(). */
function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

interface QueryOptions {
  includeDistinguishing: boolean
  includeVintage: boolean
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
  if (wine.producer) parts.push(`"${foldDiacritics(wine.producer)}"`)
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
 */
function buildQueryVariants(wine: WineIdentity, domain: string): string[] {
  const variants = [
    buildQuery(wine, domain, { includeDistinguishing: true, includeVintage: true }),
  ]
  if (wine.cuvee || wine.vineyard) {
    variants.push(buildQuery(wine, domain, { includeDistinguishing: false, includeVintage: true }))
  }
  if (wine.vintage) {
    variants.push(buildQuery(wine, domain, { includeDistinguishing: false, includeVintage: false }))
  }
  return [...new Set(variants)]
}

async function runSerperQuery(query: string, apiKey: string): Promise<SerperOrganicItem[] | null> {
  const res = await fetch(SERPER_ENDPOINT, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, gl: 'us' }),
    signal: AbortSignal.timeout(15_000),
  })
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
  apiKey: string
): Promise<Step1Outcome> {
  try {
    const variants = buildQueryVariants(wine, retailer.domain)
    let sawAnyResults = false
    let variantsTried = 0
    for (const query of variants) {
      variantsTried += 1
      const items = await runSerperQuery(query, apiKey)
      if (items === null) return { url: null, stage: 'request_failed', variantsTried }
      if (items.length === 0) continue
      sawAnyResults = true
      const match = items.find(item => isRelevantMatch(`${item.title} ${item.snippet ?? ''}`, wine))
      if (match) return { url: match.link, stage: 'found', variantsTried }
      return { url: null, stage: 'no_relevant_match', variantsTried }
    }
    return { url: null, stage: sawAnyResults ? 'no_relevant_match' : 'zero_results', variantsTried }
  } catch {
    return { url: null, stage: 'request_failed', variantsTried: 0 }
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
  apiKey: string
): Promise<Step1Outcome> {
  const parts: string[] = []
  if (wine.producer) parts.push(`"${foldDiacritics(wine.producer)}"`)
  if (wine.denomination) parts.push(`"${foldDiacritics(wine.denomination)}"`)
  if (wine.vintage) parts.push(String(wine.vintage))
  parts.push('review')
  const query = parts.join(' ')

  try {
    const items = await runSerperQuery(query, apiKey)
    if (items === null) return { url: null, stage: 'request_failed', variantsTried: 1 }

    const allowed = items.filter(item => {
      try {
        return !isDenylistedDomain(new URL(item.link).hostname)
      } catch {
        return false // an unparseable link can't be rendered anyway
      }
    })
    if (allowed.length === 0) return { url: null, stage: items.length === 0 ? 'zero_results' : 'no_relevant_match', variantsTried: 1 }

    const match = allowed.find(item => isRelevantMatch(`${item.title} ${item.snippet ?? ''}`, wine))
    if (match) return { url: match.link, stage: 'found', variantsTried: 1 }
    return { url: null, stage: 'no_relevant_match', variantsTried: 1 }
  } catch {
    return { url: null, stage: 'request_failed', variantsTried: 1 }
  }
}
