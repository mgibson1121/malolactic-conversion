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
 */
export const DENYLISTED_DOMAINS = ['cellartracker.com', 'wineberserkers.com']

export function isDenylistedDomain(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '')
  return DENYLISTED_DOMAINS.some(d => h === d || h.endsWith(`.${d}`))
}
