import type { RetailerConfig } from '@shared/config/retailers.config'

const SERPER_ENDPOINT = 'https://google.serper.dev/search'

export interface WineIdentity {
  producer: string
  denomination: string
  vintage: number | null
  // Optional — see isRelevantMatch below. Denomination alone can be too
  // generic to distinguish one bottling from another.
  cuvee?: string | null
  vineyard?: string | null
}

interface SerperOrganicItem {
  title: string
  link: string
  snippet?: string
}

interface SerperOrganicResponse {
  organic?: SerperOrganicItem[]
}

// Same relevance heuristic as backend/modules/price/serper-query.ts's
// isRelevantMatch — reimplemented locally rather than imported, since
// modules do not import from each other (CLAUDE.md §5).
const STOPWORDS = new Set([
  'domaine', 'chateau', 'château', 'maison', 'clos', 'les', 'le', 'la', 'du',
  'de', 'des', 'et', 'fils', 'wine', 'wines', 'winery', 'estate', 'cellars',
])

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
}

function significantWords(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
}

/**
 * Requires the result text (title + snippet) to contain a distinguishing
 * word from both the producer and the denomination — same bar as pricing's
 * isRelevantMatch, so an unrelated page on the right domain can't masquerade
 * as this wine's product page. When the wine has a cuvee or vineyard set,
 * also requires a word from it (2026-07-30 fix, mirrors price/serper-query.ts)
 * — denomination alone can be too generic to reach the specific bottling,
 * which for review sourcing means a critic score could be attributed to the
 * wrong product entirely, not just a wrong price.
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

function buildQuery(wine: WineIdentity, domain: string): string {
  const parts = [`site:${domain}`]
  if (wine.producer) parts.push(`"${wine.producer}"`)
  if (wine.denomination) parts.push(`"${wine.denomination}"`)
  if (wine.cuvee) parts.push(`"${wine.cuvee}"`)
  if (wine.vineyard) parts.push(`"${wine.vineyard}"`)
  if (wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}

/**
 * Step 1 — finds a single retailer product page via Serper's organic
 * `/search` endpoint with a site:-restricted query. Not the /shopping
 * endpoint (its `link` is always a google.com/search?ibp=oshop aggregator,
 * never a real product URL — see build-phases.md Phase 9), and not by
 * rendering the retailer's own on-site search (unreliable, and blocked by
 * bot detection on at least one configured retailer even where robots.txt
 * permits it — see build-phases.md Phase 7). Makes no request to the
 * retailer's own site. Returns the best relevant match's link, or null.
 */
export async function findProductPage(
  wine: WineIdentity,
  retailer: RetailerConfig,
  apiKey: string
): Promise<string | null> {
  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: buildQuery(wine, retailer.domain), gl: 'us' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as SerperOrganicResponse
    const items = json.organic ?? []
    const match = items.find(item => isRelevantMatch(`${item.title} ${item.snippet ?? ''}`, wine))
    return match?.link ?? null
  } catch {
    return null
  }
}
