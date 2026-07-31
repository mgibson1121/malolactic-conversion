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
 * Thatcher's Wine) were left on the generic default guess, unverified.
 * Live-checked 2026-07-30 after a report that View links weren't landing on
 * real product/search pages: Crush, Flatiron, and Thatcher's all run on
 * Shopify and the generic guess genuinely works for them (confirmed: each
 * returns real, relevant results via `/search?q=`). Sokolin, Acker, and
 * Wine Library did not — see their explicit cases below. Morrell has no
 * navigable on-site search URL at all (see its case below).
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
    // Fixed 2026-07-30: the generic `/search?q=` guess 404s on Sokolin's
    // Magento storefront — its real search endpoint is `catalogsearch`.
    case 'sokolin':
      return `https://www.sokolin.com/catalogsearch/result/?q=${q}`
    // Fixed 2026-07-30: the generic guess also 404s on Acker's WordPress/
    // FacetWP storefront — confirmed live via the on-page search form's
    // actual field name.
    case 'acker':
      return `https://www.ackerwines.com/shop/?fwp_search_for_shop=${q}`
    // Fixed 2026-07-30: the generic guess silently serves the full,
    // unfiltered catalog on Wine Library (the `q` param is a no-op) — same
    // failure shape as the K&L `search=`/`searchText=` bug from Phase 6.
    // The real param, recovered from the on-page search form, is `search`.
    case 'winelibrary':
      return `https://winelibrary.com/search?search=${q}`
    // No on-site search URL exists to construct: morrellwine.com's search
    // box is a client-side-only embedded commerce widget (confirmed live
    // 2026-07-30 — typing into it never changes the page URL, and every
    // plausible query-param guess 404s). Falls back to a Google
    // site-restricted search instead — same "reliably loads, gets the user
    // one click closer" reasoning already used for non-configured Pass 2
    // fallback retailers in price/serper-query.ts's buildFallbackUrl.
    case 'morrell':
      return `https://www.google.com/search?q=${encodeURIComponent(`site:morrellwine.com ${query}`)}`
    default:
      // Verified 2026-07-30 for Crush, Flatiron, and Thatcher's — see the
      // file-level comment above. Still an unverified guess for any
      // retailer added after this date until explicitly checked.
      return `https://${retailer.domain}/search?q=${q}`
  }
}
