# Session: Phase 7 — Review & critic score sourcing

> Date: 2026-07-24 | Branch: service/review-score-sourcing

## What was done

Built Phase 7 end to end, discovered via live testing that the first implementation didn't actually work, diagnosed the root cause, reworked the extraction design in discussion with a separate Claude.ai chat, reimplemented, and re-validated live.

### Commits
- `docs: phase 7 keyword-windowing architecture decision (2026-07-24)`
- `service: update price module for shared config + dead critic_scores removal`
- `service: finish removing dead critic_scores from price module`
- `shared: add review_data schema, RetailerReview and known_publication types`
- `service: add reviews module — product page discovery + rendering`
- `service: reviews module Step 2 — windowed extraction, not blind truncation`
- `test: add reviews module test suite + regression fixtures`
- `service: expose POST /api/wines/:id/fetch-reviews`
- `feat: repoint wine detail view critic scores to review_data`
- `chore: add reviews module diagnostic/validation dev scripts`

## Key decisions and what actually happened

**First pass looked done and wasn't.** Built the module exactly as originally scoped in build-phases.md — Serper organic search for product-page discovery (Step 1), Puppeteer render + GPT-4o extraction (Step 2), `gpt-extract.ts` moved unchanged from the price module per the doc's explicit note that it "doesn't need to change." 10 mocked unit tests passed, clean typecheck. Then live-tested against 21 real wines from the actual collection (the 3 seeded + 18 more supplied for broader coverage): **0 of 21 produced any attributed critic score**, despite roughly half finding genuinely correct product pages.

**Root cause, found by rendering 3 confirmed-correct pages and inspecting raw HTML independent of GPT-4o:** `gpt-extract.ts`'s inherited `html.slice(0, 80_000)` truncation was throwing away the review content before the model ever saw it. Zachys's page rendered at 879,212 characters with the review section starting at offset 384,907 — nearly 5x past the cutoff. It never mattered in the price module because pricing only ever rendered short search-results pages, not long single-product pages. Separately, K&L's product page rendered as a ~2,600-character bot-detection stub — confirmed blocked at the product-page render too, not just its search page as previously documented.

**Took this to a separate Claude.ai conversation for design review** (per the developer's request) before reworking — the resulting architecture decision is recorded in build-phases.md and CLAUDE.md and is what this session implemented.

**Reworked extraction: keyword-windowing instead of blind truncation, or a known-publication gate.** Strip `<script>`/`<style>`/`<svg>`/comments, then locate score citations via three publication-agnostic patterns:
1. Number + scoring word, either ordering ("96 points", "Score: 96"), including range/plus forms ("94-96", "94+")
2. Compact badge form — `title="Vinous"><span>V</span><span>96</span>`, common on sites showing a row of critic-score pills with the publication name only in an HTML `title` tooltip attribute, no scoring word at all

Windows around each hit are merged and capped; a stripped/capped 280,000-char fallback covers pages where nothing matches. `CRITIC_KEYWORDS` moved to a **post-extraction canonicalization role only** — consulted after GPT-4o has already returned a score, never before, so a publication the app doesn't know about yet still gets captured (`known_publication: false`, raw text preserved) instead of silently dropped.

**Building the badge-form pattern required a second real bug fix mid-session.** First attempt at the badge pattern (bare number within ~150 chars of a `title="..."` attribute) matched Tailwind CSS class-name digits ("gray-500", "px-2") before ever reaching the real score two spans later — a real false-positive-consumes-the-match bug, not a hypothetical. Fixed with a negative-lookaround excluding hyphen-adjacent numbers, verified against the real Benchmark fixture (which is exactly what surfaced the bug): went from 0 correct matches to 12/12 correct (Decanter 98, Wine Spectator 97, Vinous 96, Wine Advocate 96, Jeb Dunnuck 96, and more).

## Live validation results

Re-ran the same 21-wine sweep after the fix:
- **Before:** 0/21 wines, 0 total scores.
- **After:** 8/18 wines (the broader validation set), 65 total scores. 56 canonicalized against `CRITIC_KEYWORDS`, 9 correctly captured-but-unrecognized (Bettane & Desseauve Guide, Falstaff/Falstaff Magazine, Jasper Morris, La Revue du Vin de France, The Wine Cellar Insider, Wine & Spirits Magazine) — direct proof the publication-agnostic design captures citations the keyword list was never told about.
- Re-ran the **Phase 7 completion test** on the actual seeded wine that originally produced zero scores (Domaine Rousseau · Gevrey-Chambertin 2019) via the real browser UI: now shows 8 attributed scores (Decanter 97, La Revue du Vin de France 97, Inside Burgundy 96, View From the Cellar 95, TimAtkin.com 95, Vinous 94, Burghound 94, Wine Advocate 95).
- K&L: 0 scores across all 21 wines, both before and after — confirmed, accepted, documented gap (bot-blocked at the product-page render). Not pursuing bot-detection evasion.

**Phase 7 completion criterion is met**, on real data, verified in the actual application, not just against test fixtures.

## Test results

- Backend: 159/163 passing (4 skipped, unrelated), 8/8 suites green. New: 27 tests in `reviews.test.ts`, including 3 regression tests against the real captured HTML fixtures (`backend/modules/reviews/__fixtures__/`).
- Frontend: 27/27 passing.
- Clean `tsc --noEmit` on both `backend` and `web`.

## What's next

- Phase 6.7 (8-retailer expansion) is still scoped but not built in code — `RETAILER_CONFIG` remains 4 retailers everywhere. The keyword-window hit-rate validation should be re-run (`backend/scripts/validate-reviews.ts`) once that ships, per the open question already in build-phases.md.
- `CRITIC_KEYWORDS` is living data — add the 9 unrecognized publications surfaced during this session's live test the next time it's touched (not done here, to keep this PR scoped to the extraction fix rather than open-ended keyword-list growth).
- PR: to be opened after this commit.
