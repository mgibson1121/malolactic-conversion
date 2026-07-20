// Every retailer URL in this module is now a constructed search-results page
// (see retailer-search-url.ts for preferred retailers, buildFallbackUrl in
// serper-query.ts for fallback retailers) — never a single product page.
// The *price* attached to that URL, though, still comes from Serper's
// Google Shopping snapshot, which can be stale or reference stock that the
// retailer's own live search no longer surfaces (delisted, sold out, or a
// snapshot that's aged out of their catalog since Google last indexed it).
// That gap is what showed a K&L price for a wine K&L's live search actually
// returns zero results for.
//
// This is a generic, retailer-agnostic "does the live page actually show
// results" check — not per-site scraping logic — so it holds for whichever
// retailer shows up next, preferred or fallback alike.
const NO_RESULTS_PATTERNS = [
  /\bno results\b/i,
  /\b0 results\b/i,
  /\bno products (were )?found\b/i,
  /\bno matches found\b/i,
  /\bno items found\b/i,
  /\bwe couldn'?t find any\b/i,
  /\bdidn'?t return any results\b/i,
  /\byour search .*(returned|found) no\b/i,
]

export function pageShowsNoResults(html: string): boolean {
  // Strip tags to plain text so patterns match visible copy rather than
  // markup/attributes, and cap the scan since the signal (if present) is
  // always near the top of a results page, not buried 80k characters in.
  const text = html.replace(/<[^>]+>/g, ' ').slice(0, 20_000)
  return NO_RESULTS_PATTERNS.some(p => p.test(text))
}
