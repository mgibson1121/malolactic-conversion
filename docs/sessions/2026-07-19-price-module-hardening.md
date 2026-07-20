# Session: Price module hardening — retailer matching, live verification, pack/vintage exclusion
> Date: 2026-07-19 | Branch: feature/detail-and-scan-ui

## What was done

Follow-up hardening of the Serper-based price module (`backend/modules/price`) after production use surfaced several retailer-matching and price-accuracy bugs.

### Commits
- `fix: filter irrelevant price matches, flag vintage mismatches, fix retailer search URLs`
- `fix: normalize merchant source string before matching preferred retailers`
- `fix: generic fallback-retailer link, always show matched vintage, exclude wrong-vintage prices from stats`
- `fix: verify a retailer's live search actually returns results before trusting its price`
- `fix: detect multi-bottle packs and non-standard bottle sizes, exclude from price stats`
- `docs: split review/critic-score sourcing into Phase 6.7, document 2026-07-19 pricing fixes`

## Key decisions and bugs fixed

**K&L source-string matching regression.** The "K&L search returns unfiltered catalog" bug (fixed in an earlier session) had a related regression: Serper's `source` field for K&L isn't stable text — it appears as "K&L Wine Merchants", "K & L Wine Merchants", or "KLWines.com" depending on the listing. A literal `.includes('k&l')` check only matched one of the three forms, silently misrouting K&L into the broken fallback path. Fixed in `serper-query.ts` by stripping both sides of the comparison down to bare alphanumerics before matching.

**Google Shopping empty details page was never K&L-specific.** Serper's `link` field is always a `google.com/search?ibp=oshop` product deep-link, regardless of merchant — so every Pass-2 fallback retailer hit the same empty-shell page. Fixed generically: fallback retailers now get a constructed Google web search URL (merchant + query) instead of trusting Serper's raw `link`.

**Stale Shopping data vs. live retailer state.** A price could show for a retailer whose own live search doesn't actually list the wine, because Serper's Shopping index can be stale or delisted relative to the retailer's current site. Added `verify-listing.ts`: renders each retailer's constructed search page and drops the retailer entirely if the page shows an explicit "no results" signal. A failed or timed-out render is treated as inconclusive (retailer kept), not as evidence of delisting — avoids false negatives from flaky renders.

**Vintage handling.** Matched listings now carry `matched_vintage` and `vintage_mismatch`. The UI shows the vintage badge whenever the vintage is known (not only on mismatch), and vintage-mismatched retailers are excluded from `price_min`/`price_avg`/`price_max`/nearest-retailer selection while still appearing in the retailer list, badged as a mismatch.

**Pack and bottle-size exclusion.** New `pack-format.ts` detects multi-bottle packs ("6-Pack", "Case of 6", "6 x 750ml") and non-standard bottle sizes ("1.5L", "Magnum", "375ml") from listing titles. Both are excluded from aggregate price stats for the same reason as vintage mismatches — they'd otherwise distort `price_min`/`price_avg`/`price_max` against a standard 750ml single-bottle price.

**Critic-score extraction removed from the pricing path (deferred, not broken).** The old GPT-4o Step 2 critic-score extraction call was a structural no-op: every retailer URL this module produces is a search-results page, never a single product page, and the extraction prompt returns null for those by design. Rather than leave that silently broken inside Phase 6, the capability is deferred to a new, not-yet-scheduled Phase 6.7 (`docs/build-phases.md`).

**Docs reconciled to match.** `build-phases.md`, `CLAUDE.md`, and `wine-app-product-context.md` updated: Phase 6's completion criteria no longer requires critic scores, Phase 8's "known gap" note referencing this is marked resolved, and UX copy that claimed scores are currently extracted/displayed was corrected to say deferred to Phase 6.7.

## Test results

35 tests passing in `backend/modules/price` (`price.test.ts` plus new `pack-format.test.ts`). Clean `tsc --noEmit` on both `backend` and `web`.

## What's next

- Phase 6.7 (review/critic-score sourcing from single product pages, not search-results pages) is scoped in `build-phases.md` but not yet scheduled.
- Phase 6's outstanding manual end-to-end test (real bottle → populated price/retailer fields) is still open from the prior session and unaffected by this hardening pass.
- PR: https://github.com/mgibson1121/malolactic-conversion/pull/6
