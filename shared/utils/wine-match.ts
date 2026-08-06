/**
 * Shared query-relevance primitives for backend/modules/price/,
 * backend/modules/reviews/, and backend/modules/retailer-links/.
 *
 * Extracted 2026-08-02 — this logic (normalize, significantWords, STOPWORDS,
 * isRelevantMatch, and the producer/denomination/cuvee/vineyard query-join)
 * used to be hand-copied into all three modules under CLAUDE.md §5's "modules
 * don't import from each other" rule. That duplication is what CLAUDE.md §4
 * already carved retailers.config.ts out of for the same reason ("both price
 * and reviews need it and modules cannot import from each other" → moved to
 * shared/). This file gets the same treatment, because the duplication had
 * measurably drifted in practice, not just in theory:
 *
 * - af37ac8 (2026-07-30) had to port the cuvee/vineyard relevance fix from
 *   price/ into retailer-links/ and reviews/ by hand, in a follow-up commit,
 *   after 1f47757 landed it in price/ alone.
 * - a1caf18 (2026-07-26) — an earlier diagnosis attempt (Phase 7.1, retracted)
 *   checked the wrong copy of a sibling query-building function and found
 *   nothing wrong there, because the actual bug was in a different module's
 *   independent copy.
 * - 7ccdf2c (2026-07-29) — retailer-links/ had its own stale local duplicate
 *   of RETAILER_CONFIG that silently stopped tracking the shared config.
 *
 * A retailer/relevance fix belongs here now, once, not in three places.
 */

export interface WineIdentity {
  producer: string
  denomination: string
  vintage: number | null
  // Optional — the wine's actual distinguishing identifier when set.
  // Denomination alone is often too generic: "Champagne" or "Pommard"
  // covers every bottling a producer makes at wildly different price points.
  cuvee?: string | null
  vineyard?: string | null
  quality_classification?: string | null
}

export const STOPWORDS = new Set([
  'domaine', 'chateau', 'château', 'maison', 'clos', 'les', 'le', 'la', 'du',
  'de', 'des', 'et', 'fils', 'wine', 'wines', 'winery', 'estate', 'cellars',
])

/** Strips diacritics only — no lowercasing, no punctuation removal. Safe to
 * use inside a quoted search phrase, unlike normalize(). Moved here
 * 2026-08-04 from reviews/find-product-page.ts, which had it locally: the
 * query builders in this file were still emitting raw accents while the
 * matcher below folded them, so the query was stricter about accents than
 * the check it was feeding. Same asymmetry, one file apart. */
export function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Lowercases, strips diacritics, and removes non-alphanumeric characters. */
export function normalize(s: string): string {
  return foldDiacritics(s.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ')
}

export function significantWords(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
}

/** Normalized whole-word tokens of a text, for exact token comparison.
 * Substring comparison (what this replaced) is what let "vin" — a
 * significant word of "Vin de France" — match inside "vintage". */
function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter(Boolean))
}

// ─── Graded identity matching (2026-08-04) ───────────────────────────────────
//
// Replaces the single boolean isRelevantMatch below. A boolean cannot express
// "right producer, right appellation, wrong vintage" — which was the single
// most common real outcome across the 2026-08-04 test batch, and which the
// old check silently reported as a clean match. See
// docs/sessions/2026-08-04-core-functionality-defect-taxonomy.md §3 for the
// full argument; in short, the four dimensions of wine identity were each
// handled by a different mechanism in a different module, and no code path
// evaluated all four. This is that one code path.

export type Verdict = 'match' | 'mismatch' | 'unknown'

export interface MatchCandidate {
  /** Result or page title — the primary identity signal. */
  title: string
  /** Search-result snippet or page excerpt. Corroborating only: it is
   * deliberately NOT consulted for the producer, because body copy routinely
   * name-drops other estates. A Chateau Lafleur page mentioning its sister
   * property "Grand Village" is what put nine 99-100pt scores on a $30 wine. */
  snippet?: string
  /** Product URL — slugs usually carry producer and vintage reliably. */
  url?: string
  /** Vintage the page itself states, when known (e.g. GPT-extracted). Takes
   * precedence over a year parsed out of the title. */
  statedVintage?: number | null
}

export interface MatchVerdict {
  producer: Verdict
  denomination: Verdict
  bottling: Verdict
  vintage: Verdict
  /** The candidate's own vintage, when determinable. */
  candidateVintage: number | null
  /** |candidate − wine| in years. Null when either side is unknown. */
  vintageGap: number | null
}

/** Parses a plausible vintage year (1900–2099) out of free text or a URL. */
export function extractVintage(text: string): number | null {
  const match = text.match(/\b(19\d{2}|20\d{2})\b/)
  return match ? parseInt(match[0], 10) : null
}

/** all present → match · none present → mismatch · some present → unknown */
function verdictFor(required: string[], present: Set<string>): Verdict {
  if (required.length === 0) return 'unknown'
  const hits = required.filter(w => present.has(w)).length
  if (hits === required.length) return 'match'
  if (hits === 0) return 'mismatch'
  return 'unknown'
}

/**
 * Judges whether a candidate page/listing is about a given wine, answering
 * each dimension of identity separately rather than collapsing to a boolean.
 *
 * Scoping is deliberate and differs per dimension:
 * - producer   — title + URL only. Strictest, and requires EVERY significant
 *                word. This is the dimension that stops a different estate's
 *                page being accepted.
 * - denomination — title + URL + snippet. Retailers often omit the appellation
 *                from a title, so absence is reported as `unknown`, never as a
 *                mismatch: we cannot prove a mismatch from silence.
 * - bottling   — title + URL. `unknown` whenever the wine records no cuvee,
 *                vineyard or classification, which is the honest answer — it is
 *                also the state all 14 wines of the 2026-08-04 batch were in,
 *                so this dimension is currently inert for them by design, not
 *                by accident.
 * - vintage    — never gates acceptance (see isAcceptableMatch). It is recorded,
 *                with the gap in years, and used for ranking. A shop whose only
 *                page for a wine is two vintages off is still worth showing,
 *                labelled; rejecting it yields nothing instead of something.
 */
export function scoreMatch(candidate: MatchCandidate, wine: WineIdentity): MatchVerdict {
  const titleAndUrl = tokenSet(`${candidate.title} ${candidate.url ?? ''}`)
  const allText = tokenSet(
    `${candidate.title} ${candidate.url ?? ''} ${candidate.snippet ?? ''}`
  )

  const bottlingWords = [
    ...significantWords(wine.cuvee ?? ''),
    ...significantWords(wine.vineyard ?? ''),
    ...significantWords(wine.quality_classification ?? ''),
  ]

  const candidateVintage =
    candidate.statedVintage ??
    extractVintage(candidate.title) ??
    (candidate.url ? extractVintage(candidate.url) : null)

  let vintage: Verdict = 'unknown'
  let vintageGap: number | null = null
  if (wine.vintage != null && candidateVintage != null) {
    vintageGap = Math.abs(candidateVintage - wine.vintage)
    vintage = vintageGap === 0 ? 'match' : 'mismatch'
  }

  return {
    producer: verdictFor(significantWords(wine.producer), titleAndUrl),
    denomination: denominationVerdict(significantWords(wine.denomination), allText),
    bottling: verdictFor(bottlingWords, titleAndUrl),
    vintage,
    candidateVintage: wine.vintage == null ? null : candidateVintage,
    vintageGap,
  }
}

/** Appellations are corroborating, not identifying: any one significant word
 * confirms, but absence is `unknown` rather than `mismatch`. A retailer
 * writing "Domaine des Ardoisieres Altesse Quartz" has not told us the wine
 * ISN'T Savoie — only that they didn't say. */
function denominationVerdict(required: string[], present: Set<string>): Verdict {
  if (required.length === 0) return 'unknown'
  return required.some(w => present.has(w)) ? 'match' : 'unknown'
}

/**
 * The shared acceptance threshold: is this candidate worth spending a page
 * render and a GPT-4o call on, and worth storing?
 *
 * Producer must be positively confirmed and the appellation must corroborate.
 * Bottling may be unconfirmed but must not be contradicted. Vintage is
 * deliberately absent — it ranks (see compareByMatchQuality) and labels, it
 * never rejects.
 *
 * Callers wanting a different bar should read the verdict directly rather than
 * quietly reimplementing this; divergent per-module definitions of "same wine"
 * are the root cause this function exists to remove.
 */
export function isAcceptableMatch(v: MatchVerdict): boolean {
  return v.producer === 'match' && v.denomination === 'match' && v.bottling !== 'mismatch'
}

/** Lower is better. Sort comparator: producer, then bottling, then vintage
 * proximity — so a shop indexing both the 2022 and the 2020 always yields the
 * 2022, while a shop holding only the 2020 still yields something. */
export function compareByMatchQuality(a: MatchVerdict, b: MatchVerdict): number {
  return matchRank(a) - matchRank(b)
}

const DIMENSION_RANK: Record<Verdict, number> = { match: 0, unknown: 1, mismatch: 2 }
/** Worse than any real vintage gap, so a known-but-distant year still beats
 * an entirely unknown one. */
const UNKNOWN_VINTAGE_PENALTY = 200

function matchRank(v: MatchVerdict): number {
  const vintageRank =
    v.vintage === 'match' ? 0 : v.vintageGap != null ? Math.min(v.vintageGap, 199) : UNKNOWN_VINTAGE_PENALTY
  return DIMENSION_RANK[v.producer] * 10_000 + DIMENSION_RANK[v.bottling] * 1_000 + vintageRank
}

/**
 * Backward-compatible boolean wrapper over scoreMatch, for callers and tests
 * that only have a flat text blob. Prefer scoreMatch: this form cannot supply
 * a URL or a page-stated vintage, and discards the verdict that the UI and the
 * diagnostics both need. Retained so the migration can be done per-caller
 * rather than in one sweep.
 */
export function isRelevantMatch(text: string, wine: WineIdentity): boolean {
  return isAcceptableMatch(scoreMatch({ title: text }, wine))
}

export interface QueryFields {
  // Nullable, unlike WineIdentity's producer/denomination — callers here
  // (price/index.ts, retailer-links/index.ts) pass a WineEntry straight
  // through, whose fields are nullable until a wine has been scanned/filled
  // in. isRelevantMatch's WineIdentity, by contrast, is always given
  // pre-normalized non-null strings by its callers.
  producer: string | null
  denomination: string | null
  vintage?: number | null
  cuvee?: string | null
  vineyard?: string | null
}

/**
 * Plain space-joined producer/denomination/cuvee/vineyard[/vintage] query —
 * used for retailer on-site search URLs and Serper's Shopping endpoint,
 * where a broader, unquoted, relevance-ranked query is preferable to an
 * exact-phrase one. Not used by reviews/find-product-page.ts, which needs
 * quoted phrases for its site:-restricted organic search — see that file's
 * own buildQuery.
 */
export function buildDistinguishingQuery(
  wine: QueryFields,
  opts: { includeVintage?: boolean } = {}
): string {
  if (!wine.producer && !wine.denomination) return ''
  const parts = [wine.producer, wine.denomination, wine.cuvee, wine.vineyard].filter(Boolean)
  if (opts.includeVintage && wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}
