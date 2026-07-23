import type { RetailerLinkConfig } from './retailers.config'

/**
 * Constructs a search-results URL on the retailer's own site using their
 * native search endpoint. Same verified patterns as
 * backend/modules/price/retailer-search-url.ts (live-checked with Puppeteer
 * 2026-07-19 for these same four domains) — duplicated here rather than
 * imported because modules do not import from each other (CLAUDE.md §5).
 * Re-verify if link click-throughs start failing; see Phase 9.
 */
export function buildRetailerSearchUrl(retailer: RetailerLinkConfig, query: string): string {
  const q = encodeURIComponent(query)

  switch (retailer.slug) {
    case 'kl':
      return `https://shop.klwines.com/products?searchText=${q}`
    case 'zachys':
      return `https://www.zachys.com/search?q=${q}`
    case 'woodland':
      return `https://whwc.com/search-results/?search_query=${q}`
    case 'benchmark':
      return `https://www.benchmarkwine.com/search?q=${q}`
    default:
      return `https://${retailer.domain}/search?q=${q}`
  }
}
