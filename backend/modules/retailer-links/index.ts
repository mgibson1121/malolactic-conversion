import type { RetailerLink, WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from './retailers.config'
import { buildRetailerSearchUrl } from './build-search-url'

function buildQuery(wine: Pick<WineEntry, 'producer' | 'denomination' | 'vintage'>): string {
  if (!wine.producer && !wine.denomination) return ''
  const parts = [wine.producer, wine.denomination].filter(Boolean)
  if (wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}

/**
 * Constructs a retailer search-results URL per configured retailer from
 * wine identity fields only. Pure and synchronous — no network call, no
 * Puppeteer, no stored state. Generated fresh on every call by design
 * (build-phases.md Phase 6.6): only user-saved URLs (retailer_links on the
 * wine entry) are persisted, never these generated ones.
 */
export function getRetailerLinks(
  wine: Pick<WineEntry, 'producer' | 'denomination' | 'vintage'>
): RetailerLink[] {
  const query = buildQuery(wine)
  if (!query.trim()) return []

  return RETAILER_CONFIG.map((retailer) => ({
    slug: retailer.slug,
    name: retailer.name,
    url: buildRetailerSearchUrl(retailer, query),
  }))
}
