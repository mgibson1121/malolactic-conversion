import type { RetailerConfig } from './retailers.config'

/**
 * Constructs a live search-results URL on the retailer's own site, using the
 * retailer's native search endpoint with the wine query passed as a URL
 * parameter (not a guessed direct product link — those churn per-SKU and
 * would break constantly).
 *
 * Verified live 2026-07-19 by rendering each URL with Puppeteer (real JS
 * execution, not a static fetch) and confirming the DOM actually reflects
 * the query. K&L's own search UI (`search=`) was found to be a no-op —
 * klwines.com/products silently ignores it and serves the full unfiltered
 * catalog regardless of query; the real param, `searchText`, was recovered
 * from an archived shop.klwines.com/products?searchText=... snapshot
 * (K&L's site is behind Cloudflare bot-challenge and blocks direct
 * automated/curl access, so it can't be re-verified live from here).
 * Re-verify these patterns as part of Phase 8 (data review checkpoint) if
 * link click-throughs start failing — a retailer redesigning its search page
 * is the only thing that should break this.
 */
export function buildRetailerSearchUrl(retailer: RetailerConfig, query: string): string {
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
      // Unknown retailer slug — fall back to a generic site search guess.
      // Should not happen for anything in RETAILER_CONFIG.
      return `https://${retailer.domain}/search?q=${q}`
  }
}
