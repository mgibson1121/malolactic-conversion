import type { RetailerConfig } from '@shared/config/retailers.config'
import type { RetailerResult } from './types'
import { haversineDistanceMiles } from './proximity'
import { NYC } from '@shared/config/retailers.config'
import { buildRetailerSearchUrl } from '@shared/utils/retailer-search-url'
import { isRelevantMatch, type WineIdentity } from '@shared/utils/wine-match'
import { extractPackFormat, isNonStandardFormat, describeFormat } from './pack-format'

export type { WineIdentity }
// Re-exported for backward compatibility — the implementation now lives in
// @shared/utils/wine-match.ts alongside reviews/find-product-page.ts's
// identical copy (extracted 2026-08-02 — see that file's header for why).
export { isRelevantMatch }

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
  const pack_format = extractPackFormat(item.title)
  return {
    slug: retailer.slug,
    name: retailer.name,
    price: item.priceRaw ?? parsePriceString(item.price),
    // Serper's shopping `link` frequently points to a Google Shopping
    // aggregator page rather than the retailer's own product page (this is
    // what caused "Details aren't available for this product"). For known
    // preferred retailers we construct a live search URL on their own site
    // instead — see @shared/utils/retailer-search-url.ts.
    url: buildRetailerSearchUrl(retailer, query),
    is_preferred_retailer: isPreferred,
    distance_miles: Math.round(
      haversineDistanceMiles(NYC.lat, NYC.lng, retailer.lat, retailer.lng)
    ),
    // Always a constructed search-results URL — see buildRetailerSearchUrl.
    is_search_results_page: true,
    matched_vintage,
    vintage_mismatch: matched_vintage !== null && wine.vintage !== null && matched_vintage !== wine.vintage,
    pack_quantity: pack_format.pack_quantity,
    bottle_size_ml: pack_format.bottle_size_ml,
    non_standard_format: isNonStandardFormat(pack_format),
    format_label: describeFormat(pack_format),
    link_only: false,
  }
}

function slugifySource(source: string): string {
  return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'retailer'
}

// Fallback (Pass 2, non-configured) retailers have no known site-search URL
// pattern to construct from, unlike the four preferred retailers in
// @shared/utils/retailer-search-url.ts. Serper's `link` field can't stand in for one —
// it's always a `google.com/search?ibp=oshop` Shopping *product* deep link,
// for every merchant, with no exception (see the Pass 1 comment above). That
// deep link frequently 404s or renders "Details aren't available for this
// product," and the specific merchant it breaks for changes every time a
// different fallback retailer gets pulled in — the fix has to be structural,
// not a per-retailer patch. A plain Google web search for the merchant name
// + wine query is not the product page either, but it's a page that reliably
// loads and gets the user one click from the real listing, instead of a
// deep link that's frequently already dead on arrival.
function buildFallbackUrl(source: string, query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${source} ${query}`)}`
}

function buildFallbackResult(item: SerperShoppingItem, query: string, wine: WineIdentity): RetailerResult {
  const matched_vintage = extractYearFromTitle(item.title)
  const pack_format = extractPackFormat(item.title)
  return {
    slug: slugifySource(item.source),
    name: item.source,
    price: item.priceRaw ?? parsePriceString(item.price),
    url: buildFallbackUrl(item.source, query),
    is_preferred_retailer: false,
    distance_miles: 0,
    // Always a search page, never a single product page — see
    // is_preferred_retailer's case above. Critic-score sourcing (which
    // needs a real product page) lives in modules/reviews/, not here.
    is_search_results_page: true,
    matched_vintage,
    vintage_mismatch: matched_vintage !== null && wine.vintage !== null && matched_vintage !== wine.vintage,
    pack_quantity: pack_format.pack_quantity,
    bottle_size_ml: pack_format.bottle_size_ml,
    non_standard_format: isNonStandardFormat(pack_format),
    format_label: describeFormat(pack_format),
    link_only: false,
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

  // Both sides are stripped to bare alphanumerics before comparing merchant
  // names below. Serper's `source` string for a given merchant is not
  // stable — it's been observed as "K&L Wine Merchants", "K & L Wine
  // Merchants", and "KLWines.com" for the same retailer. A literal
  // `.includes('k&l')` check misses the spaced and no-ampersand variants and
  // silently falls through to the Pass 2 fallback (raw Google Shopping
  // aggregator link) for a retailer that should have matched — this was
  // previously observed as the K&L link pointing to an empty Google Shopping
  // details page. Stripping punctuation and whitespace from both
  // `matchKeyword` and `source` before comparing makes the match resilient
  // to that formatting drift.
  const alnumOnly = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

  // K&L is excluded from Serper-sourced matching entirely, in both passes
  // below — see the `link_only` field comment in ./types.ts. K&L's own site
  // blocks Puppeteer behind a bot-detection challenge (confirmed live
  // 2026-07-30: shop.klwines.com redirects to a "Verification Required"
  // slider stub instead of real results), so verify-listing.ts's live
  // "still listed" check can never actually confirm or refute a
  // Serper-sourced K&L price — it would otherwise silently rubber-stamp
  // whatever Serper's Google Shopping snapshot says, indistinguishable from
  // a genuinely verified price. index.ts always adds a separate, no-price
  // K&L entry instead (buildKlLinkOnlyResult). Filtering K&L's items out
  // here, before either pass, means a Serper "match" for K&L can never
  // count as a Pass 1 success — which would otherwise skip Pass 2 fallback
  // retailers entirely for a wine only K&L happens to carry — and never
  // produces a second, duplicate 'kl'-slugged entry alongside the always-
  // added one.
  const kl = retailers.find(r => r.slug === 'kl')
  const nonKlItems = kl
    ? relevantItems.filter(item => !(item.source && alnumOnly(item.source).includes(alnumOnly(kl.matchKeyword))))
    : relevantItems

  // Pass 1 — preferred retailers. Serper's shopping `link` is always a
  // google.com/search?ibp=oshop aggregator URL regardless of merchant — it
  // never contains the retailer's domain — so match against `source` (the
  // merchant display name) instead. See matchKeyword in retailers.config.ts.
  const preferred: RetailerResult[] = []
  for (const retailer of retailers) {
    const keyword = alnumOnly(retailer.matchKeyword)
    const match = nonKlItems.find(item => item.source && alnumOnly(item.source).includes(keyword))
    if (match) preferred.push(itemToRetailerResult(match, retailer, true, query, wine))
  }
  if (preferred.length > 0) return preferred

  // Pass 2 — fallback: any relevant retailer Serper found (K&L excluded, see above)
  return nonKlItems
    .filter(item => item.link && item.source)
    .slice(0, 5)
    .map(item => buildFallbackResult(item, query, wine))
}
