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

/**
 * The one way to turn a stored wine into the identity every matcher and
 * query judges it by (2026-10-01). Price, reviews, the retailer-URL resolve
 * and the confirm-link route each built this object by hand, and they had
 * drifted: only one of them passed `quality_classification`. Same lesson as
 * the header of this file, one level up — a field added in one place and
 * not the others is a matcher that silently disagrees with itself.
 */
export function identityOf(wine: {
  producer?: string | null
  denomination?: string | null
  vintage?: number | null
  cuvee?: string | null
  vineyard?: string | null
  quality_classification?: string | null
}): WineIdentity {
  return {
    producer: wine.producer ?? '',
    denomination: wine.denomination ?? '',
    vintage: wine.vintage ?? null,
    cuvee: wine.cuvee ?? null,
    vineyard: wine.vineyard ?? null,
    quality_classification: wine.quality_classification ?? null,
  }
}

export const STOPWORDS = new Set([
  'domaine', 'chateau', 'château', 'maison', 'clos', 'les', 'le', 'la', 'du',
  'de', 'des', 'et', 'fils', 'wine', 'wines', 'winery', 'estate', 'cellars',
  // The same estate-type words in German, Spanish and Italian (2026-10-01) —
  // "Weingut Keller" is sold as "Keller", "Bodegas Muga" as "Muga".
  'weingut', 'bodegas', 'bodega', 'tenuta',
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

/**
 * Words that describe a bottling rather than name it (2026-10-01): tiers
 * ("Gran Reserva", "Riserva"), selections ("Selección Especial"), old vines,
 * and vineyard/cuvée prefixes ("Viña", "Vigna", "Cuvée"). Shops drop them
 * freely; a proper name or number ("904", "Magistra", "Ardanza") they keep.
 *
 * Found on La Rioja Alta's Gran Reserva 904 2015: the scan stored the cuvée
 * as "Selección Especial", every shop sells it as "Gran Reserva 904", and
 * the bottling verdict — "no word present → mismatch" — rejected 24 of 25
 * correct listings. A descriptor can confirm a bottling; only a name can
 * reject one.
 */
const GENERIC_BOTTLING_WORDS = new Set([
  'gran', 'grand', 'grande', 'reserva', 'riserva', 'reserve', 'premier', '1er', 'cru',
  'superiore', 'classico',
  'seleccion', 'selezione', 'selection', 'selektion', 'especial', 'speciale', 'special', 'spezial',
  'vieilles', 'vignes', 'old', 'vine', 'vines', 'alte', 'reben', 'vinas', 'viejas',
  'cuvee', 'vina', 'vinedo', 'vigna', 'vigneto', 'vigne', 'lieu', 'dit',
])

/** The significant words of a cuvée/vineyard/classification that actually
 * name the bottling — see GENERIC_BOTTLING_WORDS. */
export function bottlingNameWords(s: string): string[] {
  return significantWords(s).filter(w => !GENERIC_BOTTLING_WORDS.has(w))
}

/** Honorifics/estate-type prefixes that a producer name carries on a label
 * but that retailers routinely drop from a product title. Distinct from
 * STOPWORDS: these are only stripped from the *front* of a name, because
 * they are noise as a prefix and meaningful anywhere else — "Clos" leading
 * "Clos Manou" is an estate type, while "Clos" inside "Chateau du Clos de
 * Vougeot" is part of the name. */
const HONORIFIC_PREFIXES = new Set(['domaine', 'chateau', 'château', 'maison', 'clos', 'ch', 'weingut', 'bodegas', 'bodega', 'tenuta'])

/**
 * Drops leading honorifics from a producer name, preserving the original
 * casing and accents of what remains (unlike normalize(), so the result is
 * still safe inside a quoted search phrase).
 *
 * STOPWORDS has always known `domaine`/`chateau`/`clos`/`maison` are noise —
 * but only on the matching side. The reviews query quoted the producer
 * verbatim, so `"Domaine Jean-Marc Vincent"` failed against Morrell's own
 * title, "Jean-Marc Vincent Santenay Rouge 1er Cru Gravieres 2022". The
 * price module found that exact listing at Morrell, correct vintage, in the
 * same run the reviews module found nothing there — one module's query was
 * unquoted, the other's demanded a word the retailer never wrote. 7 of the
 * 14 wines in the 2026-08-04 batch begin with "Domaine".
 *
 * Never strips the whole name: a producer called simply "Clos Manou" keeps
 * "Manou", and a name that is *only* honorifics is returned unchanged rather
 * than emptied.
 */
export function stripHonorifics(producer: string): string {
  const words = producer.trim().split(/\s+/)
  let i = 0
  while (i < words.length - 1 && HONORIFIC_PREFIXES.has(normalize(words[i]).trim())) i += 1
  return words.slice(i).join(' ')
}

/** Company legal forms a label prints and a retailer never writes —
 * "La Rioja Alta, S.A.", "Weingut Keller GmbH", "Domaine Leflaive SARL".
 * Dots and spaces inside the abbreviation are optional ("S.p.A.", "SpA",
 * "S. A."). Only ever a trailing suffix, after a comma or a space. */
const LEGAL_SUFFIX = new RegExp(
  '[\\s,]+(?:' +
    [
      's\\.?\\s?a\\.?\\s?s', // SAS
      's\\.?\\s?a\\.?\\s?r\\.?\\s?l', // SARL
      's\\.?\\s?p\\.?\\s?a', // SpA
      's\\.?\\s?r\\.?\\s?l', // Srl
      's\\.?\\s?l\\.?\\s?u', // SLU
      's\\.\\s?a|sa(?=\\.)|s\\.?a\\.', // S.A. — the bare "SA" only when dotted
      's\\.\\s?l|s\\.?l\\.', // S.L. — likewise
      's\\.\\s?s\\.', // S.S. (società semplice)
      's\\.?\\s?c\\.?\\s?e\\.?\\s?a', // SCEA
      'e\\.?\\s?a\\.?\\s?r\\.?\\s?l', // EARL
      'g\\.?\\s?a\\.?\\s?e\\.?\\s?c', // GAEC
      'gmbh(?:\\s*&\\s*co\\.?\\s*kg)?',
      'ltd',
      'inc',
      'llc',
    ].join('|') +
    ')\\.?\\s*$',
  'i'
)

/** Italian agricultural-company prefixes, likewise label-only. */
const LEGAL_PREFIX = /^(?:azienda\s+agricola|societ[aà]\s+agricola|az\.?\s*agr\.?|soc\.?\s*agr\.?)\s+/i

/**
 * Strips a company legal form from a producer name — the suffix ("S.A.",
 * "S.r.l.", "GmbH", "SARL"…) and the Italian "Azienda/Società Agricola"
 * prefix — preserving casing and accents of what remains.
 *
 * Found 2026-09-30 on the first iPhone scans: GPT-4o read "La Rioja Alta,
 * S.A." off the back label, the reviews module quoted it as an exact phrase,
 * and every one of eleven retailers returned zero results — no shop writes
 * "S.A." in a product title. Applied wherever a producer is quoted into a
 * query or compared for identity, so stored data needs no migration.
 * Never empties a name.
 */
export function stripLegalForm(producer: string): string {
  let out = producer.trim()
  for (let i = 0; i < 3; i++) {
    const next = out.replace(LEGAL_SUFFIX, '').replace(LEGAL_PREFIX, '').trim()
    if (next === out) break
    out = next
  }
  return out.length > 0 ? out : producer.trim()
}

/** Producer letters with all spacing and punctuation removed, for the
 * spacing-insensitive fallback — "Sestadisopra" and "Sesta di Sopra" are the
 * same estate styled two ways, and a label and a retailer routinely disagree. */
function compact(s: string): string {
  return normalize(s).replace(/\s+/g, '')
}

/** Shortest compact producer the spacing fallback will trust. Below this a
 * contiguous-letters match is too likely to be a different name ("Sesti"
 * inside "Sestadisopra"). */
const MIN_COMPACT_PRODUCER = 8

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
 * - bottling   — title + URL, judged on the words that *name* the bottling;
 *                descriptors ("Gran Reserva", "Vieilles Vignes") can confirm
 *                but never reject (2026-10-01, see GENERIC_BOTTLING_WORDS).
 *                `unknown` whenever the wine records no cuvee,
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

  const titleUrlText = `${candidate.title} ${candidate.url ?? ''}`
  return {
    producer: producerVerdict(wine.producer, titleAndUrl, titleUrlText),
    denomination: siblingDenomination(wine.denomination, titleUrlText)
      ? 'mismatch'
      : denominationVerdict(significantWords(wine.denomination), allText),
    bottling: bottlingVerdict(bottlingWords, titleAndUrl),
    vintage,
    candidateVintage: wine.vintage == null ? null : candidateVintage,
    vintageGap,
  }
}

/** Bottling: judged on the words that name it. Descriptors alone can confirm
 * (`match` when every one is present) but never reject — a title without
 * "Selección Especial" is silence, not evidence of another wine. */
function bottlingVerdict(words: string[], present: Set<string>): Verdict {
  const naming = words.filter(w => !GENERIC_BOTTLING_WORDS.has(w))
  if (naming.length > 0) return verdictFor(naming, present)
  return verdictFor(words, present) === 'match' ? 'match' : 'unknown'
}

/** Producer: every significant word, after dropping the legal form. Failing
 * that, a spacing-insensitive check — the whole producer, letters only, as
 * one contiguous run of the title's letters — so "Sestadisopra" on a label
 * matches "Sesta di Sopra" on a shelf, and vice versa. The fallback can only
 * upgrade a verdict to `match`, and only for producers long enough that a
 * contiguous match is not a coincidence. */
function producerVerdict(producer: string, titleAndUrl: Set<string>, titleUrlText: string): Verdict {
  const stripped = stripLegalForm(producer)
  const byWords = verdictFor(significantWords(stripped), titleAndUrl)
  if (byWords === 'match') return byWords
  const needle = compact(stripped)
  if (needle.length >= MIN_COMPACT_PRODUCER && compact(titleUrlText).includes(needle)) return 'match'
  return byWords
}

/**
 * Does this text name the producer? The same rule scoreMatch applies to a
 * title — legal form dropped, every significant word, spacing-insensitive
 * fallback — for callers holding a whole page rather than a title (the
 * price module's live "still listed" check). Null when the producer has no
 * significant words, so "couldn't check" stays distinct from "absent".
 *
 * That check kept its own copy of the rule and missed both 2026-09-30 fixes:
 * a "Weingut Keller GmbH" page would need "gmbh" on it, and every "Sesta di
 * Sopra" page failed a producer stored as "Sestadisopra".
 */
export function mentionsProducer(text: string, producer: string | null): boolean | null {
  if (significantWords(stripLegalForm(producer ?? '')).length === 0) return null
  return producerVerdict(producer ?? '', tokenSet(text), text) === 'match'
}

/** Connectors that join an appellation's type to its place: "Brunello *di*
 * Montalcino", "Barbera *d'*Alba", "Châteauneuf-*du*-Pape". */
const DENOMINATION_CONNECTORS = new Set(['di', 'de', 'del', 'della', 'dei', 'delle', 'dello', 'du', 'des', 'd'])

/**
 * True when the title or URL names a *sibling* appellation of the wine's own
 * — the same place, a different type: "Rosso di Montalcino" against a Brunello
 * di Montalcino, "Nebbiolo d'Alba" against a Barbera d'Alba. A producer's
 * lineup routinely contains exactly these pairs, at very different prices, and
 * any-one-word corroboration ("montalcino") could not tell them apart.
 *
 * Found 2026-09-30: the only listing accepted for a Sesta di Sopra Brunello
 * 2018 was the estate's Rosso di Montalcino at $42.01. Title and URL only —
 * a snippet mentioning "also try their Rosso" says nothing about this page.
 * Only applies to "<type> <connector> <place>" denominations; others are
 * judged as before.
 */
function siblingDenomination(denomination: string | null | undefined, titleUrlText: string): boolean {
  if (!denomination) return false
  const d = normalize(denomination).split(/\s+/).filter(Boolean)
  const i = d.findIndex((t, k) => k > 0 && k < d.length - 1 && DENOMINATION_CONNECTORS.has(t))
  if (i < 0) return false
  const type = d[i - 1]
  const place = d[i + 1]
  const t = normalize(titleUrlText).split(/\s+/).filter(Boolean)
  for (let k = 1; k + 1 < t.length; k++) {
    if (DENOMINATION_CONNECTORS.has(t[k]) && t[k + 1] === place) {
      const before = t[k - 1]
      if (before !== type && !DENOMINATION_CONNECTORS.has(before) && !/^\d+$/.test(before)) return true
    }
  }
  return false
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
 *
 * Diacritics are folded (2026-08-04). This function sat forty lines below a
 * normalize() that has always stripped accents and did not strip them
 * itself, so the queries it emits were stricter about accents than the
 * matcher they feed: retailer URLs went out as `Gour%20de%20Chaul%C3%A9`
 * and `Mangot%20Saint-%C3%89milion` while the check on the way back folded
 * both sides. Same asymmetry that reviews/find-product-page.ts fixed for its
 * own quoted query on 2026-08-02, one file apart.
 */
export function buildDistinguishingQuery(
  wine: QueryFields,
  opts: { includeVintage?: boolean } = {}
): string {
  if (!wine.producer && !wine.denomination) return ''
  const producer = wine.producer ? stripLegalForm(wine.producer) : wine.producer
  const parts = [producer, wine.denomination, wine.cuvee, wine.vineyard].filter(Boolean)
  if (opts.includeVintage && wine.vintage) parts.push(String(wine.vintage))
  return foldDiacritics(parts.join(' '))
}
