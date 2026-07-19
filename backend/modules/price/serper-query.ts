import type { RetailerConfig } from './retailers.config'
import type { RetailerResult } from './types'
import { haversineDistanceMiles } from './proximity'
import { NYC } from './retailers.config'
import { buildRetailerSearchUrl } from './retailer-search-url'

const SERPER_ENDPOINT = 'https://google.serper.dev/shopping'

interface SerperShoppingItem {
  title: string
  source: string
  link: string
  price?: string
  priceRaw?: number
}

interface SerperResponse {
  shopping?: SerperShoppingItem[]
}

function parsePriceString(price?: string): number | null {
  if (!price) return null
  const n = parseFloat(price.replace(/[^0-9.]/g, ''))
  return isNaN(n) || n <= 0 ? null : n
}

export interface WineIdentity {
  producer: string
  denomination: string
  vintage: number | null
}

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
 * Heuristic relevance check — Serper's shopping results for a wine query
 * frequently include unrelated products (other producers, accessories,
 * unrelated bottles that happen to share a keyword). Without this check a
 * completely wrong item could be shown as if it were a real price for this
 * wine. Requires the listing title to contain a distinguishing word from
 * both the producer and the denomination (generic words like "Domaine" or
 * "Clos" are excluded since they're not distinguishing on their own).
 */
export function isRelevantMatch(title: string, wine: WineIdentity): boolean {
  const normTitle = normalize(title)
  const producerWords = significantWords(wine.producer)
  const denomWords = significantWords(wine.denomination)
  const producerHit = producerWords.length === 0 || producerWords.some(w => normTitle.includes(w))
  const denomHit = denomWords.length === 0 || denomWords.some(w => normTitle.includes(w))
  return producerHit && denomHit
}

/** Parses a 4-digit 19xx/20xx vintage year out of a listing title, if present. */
export function extractYearFromTitle(title: string): number | null {
  const match = title.match(/\b(19\d{2}|20\d{2})\b/)
  return match ? parseInt(match[0], 10) : null
}

function itemToRetailerResult(
  item: SerperShoppingItem,
  retailer: RetailerConfig,
  isPreferred: boolean,
  query: string,
  wine: WineIdentity
): RetailerResult {
  const matched_vintage = extractYearFromTitle(item.title)
  return {
    slug: retailer.slug,
    name: retailer.name,
    price: item.priceRaw ?? parsePriceString(item.price),
    // Serper's shopping `link` frequently points to a Google Shopping
    // aggregator page rather than the retailer's own product page (this is
    // what caused "Details aren't available for this product"). For known
    // preferred retailers we construct a live search URL on their own site
    // instead — see retailer-search-url.ts. This is also the URL Puppeteer
    // renders in Step 2 for critic score extraction, so fixing it here fixes
    // both the click-through and the score extraction quality.
    url: buildRetailerSearchUrl(retailer, query),
    critic_scores: [],
    is_preferred_retailer: isPreferred,
    distance_miles: Math.round(
      haversineDistanceMiles(NYC.lat, NYC.lng, retailer.lat, retailer.lng)
    ),
    // Always a constructed search-results URL — see buildRetailerSearchUrl.
    is_search_results_page: true,
    matched_vintage,
    vintage_mismatch: matched_vintage !== null && wine.vintage !== null && matched_vintage !== wine.vintage,
  }
}

function buildFallbackResult(item: SerperShoppingItem, wine: WineIdentity): RetailerResult {
  const hostname = (() => {
    try { return new URL(item.link).hostname.replace(/^www\./, '') } catch { return item.source }
  })()
  const matched_vintage = extractYearFromTitle(item.title)
  return {
    slug: hostname,
    name: item.source,
    price: item.priceRaw ?? parsePriceString(item.price),
    url: item.link,
    critic_scores: [],
    is_preferred_retailer: false,
    distance_miles: 0,
    // Unknown — this is Serper's raw link for a non-configured retailer. It
    // may or may not be a single product page. Leave false so Step 2 still
    // gets a chance to extract from it (best-effort, not guaranteed null
    // like the constructed preferred-retailer search URLs).
    is_search_results_page: false,
    matched_vintage,
    vintage_mismatch: matched_vintage !== null && wine.vintage !== null && matched_vintage !== wine.vintage,
  }
}

export async function querySerper(
  query: string,
  retailers: RetailerConfig[],
  apiKey: string,
  wine: WineIdentity
): Promise<RetailerResult[]> {
  let items: SerperShoppingItem[] = []
  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: `${query} wine`, gl: 'us' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const json = await res.json() as SerperResponse
    items = json.shopping ?? []
  } catch {
    return []
  }

  if (items.length === 0) return []

  // Relevance filter — Serper's shopping results frequently include items
  // that are not actually this wine (different producer, accessories, an
  // unrelated bottle sharing a keyword). Filtering here means an irrelevant
  // match can never masquerade as a real price for this wine — see
  // isRelevantMatch. Applied before both passes below.
  const relevantItems = items.filter(item => isRelevantMatch(item.title, wine))

  // Pass 1 — preferred retailers. Serper's shopping `link` is always a
  // google.com/search?ibp=oshop aggregator URL regardless of merchant — it
  // never contains the retailer's domain — so match against `source` (the
  // merchant display name) instead. See matchKeyword in retailers.config.ts.
  //
  // Both sides are stripped to bare alphanumerics before comparing. Serper's
  // `source` string for a given merchant is not stable — it's been observed
  // as "K&L Wine Merchants", "K & L Wine Merchants", and "KLWines.com" for
  // the same retailer. A literal `.includes('k&l')` check misses the spaced
  // and no-ampersand variants and silently falls through to the Pass 2
  // fallback (raw Google Shopping aggregator link) for a retailer that
  // should have matched — this was previously observed as the K&L link
  // pointing to an empty Google Shopping details page. Stripping punctuation
  // and whitespace from both `matchKeyword` and `source` before comparing
  // makes the match resilient to that formatting drift.
  const alnumOnly = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const preferred: RetailerResult[] = []
  for (const retailer of retailers) {
    const keyword = alnumOnly(retailer.matchKeyword)
    const match = relevantItems.find(item => item.source && alnumOnly(item.source).includes(keyword))
    if (match) preferred.push(itemToRetailerResult(match, retailer, true, query, wine))
  }
  if (preferred.length > 0) return preferred

  // Pass 2 — fallback: any relevant retailer Serper found
  return relevantItems
    .filter(item => item.link && item.source)
    .slice(0, 5)
    .map(item => buildFallbackResult(item, wine))
}
