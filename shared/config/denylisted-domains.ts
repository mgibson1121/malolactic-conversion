/**
 * Domains this project must never scrape or extract from, regardless of what
 * an open web search surfaces — see CLAUDE.md §15: "Do not scrape
 * CellarTracker or WineBerserkers — both prohibit automated access in their
 * ToS." This is a hard ToS/legal boundary, unlike a live bot-detection block
 * (e.g. K&L's), which is a technical obstacle fair to route around — see
 * CLAUDE.md §15's distinction between the two.
 *
 * Used by reviews/find-product-page.ts's open-web fallback pass (Phase 7.3,
 * 2026-08-02): unlike the site:-restricted per-retailer search, the fallback
 * query isn't scoped to a domain the developer has already vetted, so an
 * open search could otherwise surface either of these. Reused regardless of
 * what Serper returns — never rely on Serper simply not indexing them.
 *
 * Not every entry is a ToS boundary — see wine-searcher.com's own note
 * below. The list is "domains this project does not extract from"; the
 * reason differs per entry and is recorded per entry.
 */
export const DENYLISTED_DOMAINS = [
  'cellartracker.com',
  'wineberserkers.com',
  // Added 2026-08-04, for a different reason than the two above — not a ToS
  // prohibition but a settled project decision. Phase 6 migrated away from
  // Wine-Searcher deliberately; the Phase 7.3 open-web fallback then handed
  // back a wine-searcher.com page for Montus, reintroducing the source the
  // project had already rejected. If that decision is ever revisited, this
  // is the line to reconsider — the two above are not negotiable.
  'wine-searcher.com',
]

export function isDenylistedDomain(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  return DENYLISTED_DOMAINS.some(d => h === d || h.endsWith(`.${d}`))
}

/**
 * URL shapes that cannot be a single retailer product page, rejected before
 * spending a Puppeteer render and a GPT-4o call on them (Phase 9.1).
 *
 * Every one of these was actually accepted and stored as a "product page"
 * during the 2026-08-04 batch: a JJ Buckley PDF
 * (images.jjbuckley.com/…/2011_BORDEAUX_REPORT.pdf), a Zachys auction
 * bidding-history page (bid.zachys.com/auctions/bidding-history/…), and two
 * retailer blog/offer posts (crushwineco.com/blogs/offers/…,
 * nyc.flatiron-wines.com/blogs/…). All four returned zero scores, which is
 * luck rather than safety: a retailer newsletter covering eight wines with
 * eight scores is exactly the page that would attribute the wrong one.
 *
 * Deliberately shape-based and retailer-agnostic, matching verify-listing's
 * approach — a per-site URL pattern list would rot the moment a new retailer
 * is configured.
 */
const NON_PRODUCT_URL_PATTERNS: RegExp[] = [
  /\.pdf(\?|#|$)/i,        // a report, not a product page
  /\/blogs?\//i,           // retailer newsletters and offer posts
  /\/news\//i,
  /\/search\b/i,           // a results page, which is what price/ wants, not reviews/
  /\/cart\b/i,
  /\/checkout\b/i,
  /(^|\.)bid\./i,          // auction hosts, e.g. bid.zachys.com
  /\/auctions?\//i,
  /\/bidding-history\//i,
]

/** True when the URL's shape rules it out as a single product page. Errs
 * toward allowing: an unparseable or unusual URL is judged by the graded
 * matcher and the extraction, not rejected here on suspicion. */
export function isNonProductUrl(url: string): boolean {
  return NON_PRODUCT_URL_PATTERNS.some(p => p.test(url))
}
