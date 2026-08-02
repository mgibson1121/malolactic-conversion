import type { RetailerConfig } from '@shared/config/retailers.config'

/**
 * Constructs a live search-results URL on the retailer's own site, using the
 * retailer's native search endpoint with the wine query passed as a URL
 * parameter (not a guessed direct product link — those churn per-SKU and
 * would break constantly).
 *
 * Extracted 2026-08-02 from backend/modules/price/retailer-search-url.ts and
 * backend/modules/retailer-links/build-search-url.ts, which were
 * byte-for-byte identical logic (comments aside) hand-duplicated under
 * CLAUDE.md §5. See shared/utils/wine-match.ts's file header for the
 * concrete drift this caused in practice (ba61e23 had to patch this same
 * switch statement in two files by hand).
 *
 * Verified live 2026-07-19 by rendering each URL with Puppeteer (real JS
 * execution, not a static fetch) and confirming the DOM actually reflects
 * the query. K&L's own search UI (`search=`) was found to be a no-op —
 * klwines.com/products silently ignores it and serves the full unfiltered
 * catalog regardless of query; the real param, `searchText`, was recovered
 * from an archived shop.klwines.com/products?searchText=... snapshot
 * (K&L's site is behind Cloudflare bot-challenge and blocks direct
 * automated/curl access, so it can't be re-verified live from here).
 * Re-verify these patterns as part of Phase 9 (data review checkpoint) if
 * link click-throughs start failing — a retailer redesigning its search page
 * is the only thing that should break this.
 *
 * The seven retailers added 2026-07-29 to shared/config/retailers.config.ts
 * (Sokolin, Acker Wines, Wine Library, Morrell & Company, Crush Wine &
 * Spirits, Flatiron Wines & Spirits, Thatcher's Wine) were left on the
 * generic default guess, unverified. Live-checked 2026-07-30 after a report
 * of bad price matches and dead View links: Crush, Flatiron, and Thatcher's
 * all run on Shopify and the generic guess genuinely works for them
 * (confirmed: each returns real, relevant results via `/search?q=`).
 * Sokolin, Acker, and Wine Library did not — see their explicit cases
 * below. Morrell has no navigable on-site search URL at all (see its case
 * below).
 *
 * JJ Buckley (added 2026-08-02) uses the generic `/search?q=` guess,
 * unverified with Puppeteer — re-verify before relying on it the way the
 * checked retailers above have been.
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
      // retailer added after this date until explicitly checked (including
      // JJ Buckley, added 2026-08-02).
      return `https://${retailer.domain}/search?q=${q}`
  }
}
