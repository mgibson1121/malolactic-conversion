# Session: Phase 7.1 (retracted) / Phase 7.2 — Guided retailer search with confirmed-URL extraction

> Date: 2026-07-26 | Branch: feature/guided-retailer-search

## What was done

### Commits
- `docs: phase 7.1 retraction + phase 7.2 guided retailer search spec`
- `fix: drop vintage from retailer-links search query`
- `service: extend gpt-extract.ts to also extract the page's stated vintage`
- `refactor: extract aggregatePriceData from fetchPriceData`
- `service: add POST /api/wines/:id/confirm-retailer-link`
- `feat: guided retailer search with confirmed-URL extraction`

## The story: two proposed fixes, one retracted, one confirmed and built

Both phases originated from a separate Claude.ai chat the developer was consulting. Both times, the proposed diagnosis was tested empirically against the real system before writing any code — the discipline established in the Phase 7 session — and the outcomes diverged.

**Phase 7.1 (retracted): "vintage in the search query breaks a retailer's own search."** The claim: both `price/serper-query.ts` (via `verify-listing.ts`) and `reviews/find-product-page.ts` append the wine's vintage to their search queries, and a retailer's own search is more literal than Google's, so the vintage token was theorized to cause false negatives. Tested directly against the cited case (Zachys / Clos des Papes / 2020):
- Serper's organic search found the correct 2020 listing whether or not the vintage was in the query.
- Zachys's own on-site search returned 140+ results for both the vintage-qualified and vintage-free URLs.
- The actual production `pageShowsNoResults()` function returned `false` for both real rendered pages.

No code changed. The doc records this as retracted, not deleted, with the reasoning: the original observation (typing "Clos des Papes" into Zachys.com's search bar and getting 4 results across vintages) was a manual website search, not a run of the app's own query-building logic — consistent with, not evidence against, what was found.

**Phase 7.2 (built): the real bug, in a third location.** The developer's own reproduction — clicking the actual "Find Reviews" → "Search Zachys" button in the running app and getting zero results, then manually simplifying the query and getting results — pointed at `backend/modules/retailer-links/index.ts`, a *third* independent copy of query-building logic (distinct from both `price/` and `reviews/`, each module keeping its own per module-isolation convention) that nobody had tested yet. Confirmed directly, twice:
1. Via the real production API: `GET /:id/retailer-links` for Clos des Papes showed the vintage-qualified URL.
2. Via the real browser, navigating to that exact URL: **0 results**, "We are sorry! We couldn't find results," with a "Trending products" fallback grid. The vintage-free version of the same URL: **4 results**, correctly listing Clos des Papes 2015/2023/2024 (no 2020 currently in stock — explaining why the vintage-qualified query specifically failed).

Note on methodology: an earlier headless-Puppeteer check of the same URLs (during the Phase 7.1 investigation) had shown large result counts for both — the opposite of what the real browser showed. The likely cause: `renderPageHtml()` waits for `domcontentloaded`, which fires before Zachys's client-side search finishes resolving; the page's initial HTML shell can carry a stale/placeholder result count that a full page settle replaces. This is a real fidelity gap in headless-Puppeteer-based "does this page show results" checks and is flagged as a follow-up, not fixed in this session (it didn't block Phase 7.2, since the confirm-retailer-link flow renders a specific known product page, not a search-results page).

## What Phase 7.2 actually built

1. **Query fix** — `retailer-links/index.ts`'s `buildQuery()` drops the vintage token.
2. **`gpt-extract.ts` extended** to also extract the vintage stated on a rendered page, alongside the existing price/critic-scores extraction.
3. **`aggregatePriceData()` extracted** from `fetchPriceData` into a reusable pure function — needed because the new route recomputes price stats after updating a single retailer's entry, and duplicating that math wasn't worth it.
4. **New route** `POST /api/wines/:id/confirm-retailer-link` — given `{ slug, url }`, renders the page, runs the same keyword-window + GPT-4o pipeline as automated review sourcing, and writes into both `price_data.retailers[]` (price, vintage, `is_search_results_page: false`) and `review_data` (critic scores). Always saves `retailer_links[slug]` first, even on extraction failure, so a manual find is never lost.
5. **Guided UI** in `RetailerLinksSection` (opt-in `guided` prop, enabled only in the wine detail view): clicking Search tracks the pending retailer; regaining tab focus checks the clipboard for a matching-domain URL (handling K&L's `shop.`/`www.` subdomain split) and offers to save + extract, falling back to manual paste when clipboard access is denied or doesn't match. Retailers where automated sourcing already found scores get a de-emphasized Search button and a "✓ N scores found" badge.

## Live validation

Full end-to-end test against the real Clos des Papes wine entry, using a real current Zachys product URL (`chateauneuf-du-pape-clos-des-papes-2020-750ml`, found live via Serper):
- `matched_vintage: 2020`, `vintage_mismatch: false` — correct.
- `retailer_links.zachys` saved.
- `review_data` populated with 5 real, correctly canonicalized critic scores: Vinous 96, Wine Advocate 96, Decanter 99, Jeb Dunnuck 96, Wine Spectator 97.
- Confirmed rendering correctly in the actual running UI: Review Links, Critic Scores, Pricing (with the 2020-vintage badge), and the "✓ 5 scores found" de-emphasis badge on the Zachys row all displayed correctly.
- One honest gap: `price` came back `null` in this run. The keyword-window is optimized to find windows around score citations; this particular page's price text didn't fall inside those windows. Not a bug — the extraction contract is "return null rather than guess" — but a known trade-off of score-focused windowing worth knowing about.

## Test results

- Backend: 164/168 passing (4 skipped, unrelated), 8/8 suites green.
- Frontend: 34/34 passing (12 new tests for the guided-confirmation flow: clipboard matching, permission-denied fallback, save/dismiss, scores-found badge).
- Clean `tsc --noEmit` on both `backend` and `web`.
- No dedicated route-level test for `confirm-retailer-link` itself — consistent with the existing codebase convention (`/fetch-price` and `/fetch-reviews` also have none); covered instead by testing the pieces it composes (`aggregatePriceData`, `gpt-extract`'s vintage field, the frontend flow) and the live manual test above.

## What's next

- The `domcontentloaded`-too-early rendering-fidelity gap noted above (headless Puppeteer can capture a page before client-side search fully resolves) — worth a closer look if `pageShowsNoResults()` or similar checks start showing false negatives/positives in practice, but not addressed here.
- Price extraction on confirm-retailer-link pages can come back null when the price text falls outside the score-citation windows — could widen the window or add a price-specific anchor pattern if this turns out to matter in practice.
- PR: to be opened after this commit.
