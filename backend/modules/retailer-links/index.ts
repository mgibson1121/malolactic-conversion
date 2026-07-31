import type { RetailerLink, WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { buildRetailerSearchUrl } from './build-search-url'

// No vintage token (Phase 7.2, 2026-07-26) — a retailer's own search can be
// a literal/narrow match rather than relevance-ranked, and an added vintage
// risks a false "no results" even when the retailer carries the wine under
// a different vintage's listing (confirmed live: Zachys returns 0 results
// for "Clos des Papes Châteauneuf-du-Pape 2020" but 4 for the same query
// without the year). This is a search-results page, not a lookup for one
// exact SKU — a broader query that reliably surfaces the retailer's actual
// listings is more useful here than a narrower one that risks nothing at
// all.
// cuvee/vineyard included (2026-07-30 fix) — denomination alone is often
// too generic to land the search on the right bottling: "Drappier
// Champagne" or "Louis Latour Pommard" covers every product a producer
// sells at that denomination, not specifically "Grande Sendrée" or "Les
// Épenots". Same reasoning as price/index.ts's buildQuery.
function buildQuery(wine: Pick<WineEntry, 'producer' | 'denomination' | 'cuvee' | 'vineyard'>): string {
  if (!wine.producer && !wine.denomination) return ''
  return [wine.producer, wine.denomination, wine.cuvee, wine.vineyard].filter(Boolean).join(' ')
}

/**
 * Constructs a retailer search-results URL per configured retailer from
 * wine identity fields only. Pure and synchronous — no network call, no
 * Puppeteer, no stored state. Generated fresh on every call by design
 * (build-phases.md Phase 6.6): only user-saved URLs (retailer_links on the
 * wine entry) are persisted, never these generated ones.
 */
export function getRetailerLinks(
  wine: Pick<WineEntry, 'producer' | 'denomination' | 'vintage' | 'cuvee' | 'vineyard'>
): RetailerLink[] {
  const query = buildQuery(wine)
  if (!query.trim()) return []

  return RETAILER_CONFIG.map((retailer) => ({
    slug: retailer.slug,
    name: retailer.name,
    url: buildRetailerSearchUrl(retailer, query),
  }))
}
