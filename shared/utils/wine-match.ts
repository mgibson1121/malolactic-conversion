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
}

export const STOPWORDS = new Set([
  'domaine', 'chateau', 'château', 'maison', 'clos', 'les', 'le', 'la', 'du',
  'de', 'des', 'et', 'fils', 'wine', 'wines', 'winery', 'estate', 'cellars',
])

/** Lowercases, strips diacritics, and removes non-alphanumeric characters. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
}

export function significantWords(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
}

/**
 * Heuristic relevance check — requires the given text (a listing title, or a
 * search result's title + snippet) to contain a distinguishing word from
 * both the producer and the denomination, and — when the wine has a cuvee or
 * vineyard set — a word from that too, since denomination alone can be too
 * generic to distinguish one bottling from another.
 */
export function isRelevantMatch(text: string, wine: WineIdentity): boolean {
  const normText = normalize(text)
  const producerWords = significantWords(wine.producer)
  const denomWords = significantWords(wine.denomination)
  const distinguishingWords = [
    ...significantWords(wine.cuvee ?? ''),
    ...significantWords(wine.vineyard ?? ''),
  ]
  const producerHit = producerWords.length === 0 || producerWords.some(w => normText.includes(w))
  const denomHit = denomWords.length === 0 || denomWords.some(w => normText.includes(w))
  const distinguishingHit = distinguishingWords.length === 0 || distinguishingWords.some(w => normText.includes(w))
  return producerHit && denomHit && distinguishingHit
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
