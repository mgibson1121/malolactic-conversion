import type { RetailerConfig } from '@shared/config/retailers.config'

/**
 * Constructs a search-results URL on the retailer's own site using their
 * native search endpoint. Same verified patterns as
 * backend/modules/price/retailer-search-url.ts (live-checked with Puppeteer
 * 2026-07-19 for these same four domains) — duplicated here rather than
 * imported because modules do not import from each other (CLAUDE.md §5);
 * both copies read from the same @shared/config/retailers.config data as of
 * 2026-07-29, closing a gap where this file had its own stale local copy of
 * RETAILER_CONFIG that never got migrated to shared/ despite Phase 7's
 * documentation saying it would be.
 *
 * The seven retailers added 2026-07-29 (Sokolin, Acker Wines, Wine Library,
 * Morrell & Company, Crush Wine & Spirits, Flatiron Wines & Spirits,
 * Thatcher's Wine) fall through to the generic default below — their
 * on-site search URL patterns have not been live-verified with Puppeteer the
 * way the original four were. Re-verify and add explicit cases here before
 * relying on their search links working correctly.
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
      // Unverified generic guess — see the function-level comment above.
      return `https://${retailer.domain}/search?q=${q}`
  }
}
