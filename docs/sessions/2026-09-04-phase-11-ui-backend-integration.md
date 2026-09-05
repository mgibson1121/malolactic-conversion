# 2026-09-04 — Phase 11: apply UI to backend & local integration testing

**Branch:** `feature/phase-11-ui-backend-integration`
**Status:** Code complete, manually verified locally.
**PR:** [#31](https://github.com/mgibson1121/malolactic-conversion/pull/31) — open for developer review, not merged.

## What was done

1. **Reconciled a stale carryover item in `build-phases.md`'s Phase 11 entry.** It still
   listed "critic-score display prioritized from a preferred-source list" as an open item
   from Phase 10's first feedback round. `docs/specs/2026-09-01-phase-10-v2-web-ui-design-
   requirements.md` §3.5 had already decided against that for this design pass — show every
   score, not one prioritized — and `docs/specs/2026-09-03-...gap-analysis.md` §2.5
   independently reached the same conclusion. Corrected the Phase 11 entry to say so
   explicitly, citing both docs, so it doesn't get re-proposed by a future session. The other
   carryover item (GPT-inferred vs. raw-fact distinction) was genuinely still open — see #3.

2. **Full token-driven re-skin of `web/src/index.css`** (and a font `<link>` in
   `web/index.html`) to match the finalized Phase 10 design canvas ("Wine App UX Design v2").
   Pulled the actual dark-theme design tokens directly out of the published canvas's `.dc.html`
   artboards (not the design-tool's own editor chrome, which uses an unrelated palette) —
   `#121212` background, `#1D6AE5` blue / `#FFC729` yellow accents, Newsreader (display) +
   Manrope (body) fonts, pill-shaped badges, tabular-nums on numeric values. Every existing
   class name and component structure stayed the same — this was a systematic color/radius/
   font-family substitution across ~1958 lines, not a rebuild. Six-hotspot nav, a dedicated
   Settings screen, and light/dark toggling are explicitly out of scope (Phase 12, and the
   canvas itself only defines one dark palette).

3. **Added the GPT-inferred-vs-raw-fact visual marker** (the one still-genuinely-open Phase
   10 feedback item — neither the canvas nor any spec had designed this). `vintage_rating`
   and `drinking_window` badges now show a small "Sourced" marker when their `_source` field
   is `'derived'` (came from automated review extraction) vs. no marker when `'manual'`.
   Reuses the canvas's own `.badge-tier` component rather than inventing new visual language.
   Deliberately did **not** add this to per-citation critic-score attributes (drinking window,
   vintage character, deal) — their own type comments establish those are raw stated-in-source
   facts, never inferred.

4. **Surfaced `RetailerPrice.verification`** (`'verified'|'unverified'|'unchecked'`), computed
   backend-side since Phase 6 but never rendered anywhere — added a small pill (reusing the
   canvas's `.pill`/`.pill-green`/`.pill-red` primitives) to each retailer row in
   `PriceSection.tsx`. `'unchecked'` renders nothing, matching the app's existing convention
   for "never attempted."

5. **Found and fixed a real, previously-shipped bug**: the Evaluate flow's post-save tag-review
   step (`wine-app-product-context.md`'s Phase 4 spec: "after saving a note the user is
   prompted to review their list tags") was **completely unreachable** — `App.tsx`'s
   `handleEvaluateSave` called `setEvaluatingWine(null)` immediately after save, unmounting
   `EvaluateForm` before its own internal `setStep('tag_review')` could ever take effect.
   Confirmed via live testing: saving a note closed the modal outright with no tag-review
   screen shown at all. Fixed by removing the premature close — `EvaluateForm` now owns
   closing itself via its existing `handleTagDone → onCancel` path. No test caught this because
   `EvaluateForm.test.tsx` doesn't exist (a pre-existing coverage gap, not introduced here).

6. **Punch-list fixes surfaced by exploration + live testing:**
   - `.scan-saved-badge--draft` had no CSS rule, so a **draft** ("not yet saved") wine's badge
     rendered with the same green "saved" styling as an actually-promoted one — a real
     misleading-state bug. Added the missing rule (neutral, not green).
   - `.tag-review-intro`/`.tag-review-toggles` (used in the tag-review step above) had no CSS
     rules either — fixed alongside the reachability fix in #5.
   - `.wine-tag-controls--quick` (Discovered tab's quick tag chips) was a dead selector with
     no rule — gave it the intended lighter chip treatment from the design spec.
   - `WineDetailModal.tsx`'s `RETAILER_LABELS` was hardcoded to 4 retailers; `RETAILER_CONFIG`
     has 12 (Phase 7.3). Sourced the label map from the shared config instead — confirmed live
     that a saved Zachys link now reads "Zachys review" instead of falling back to a raw slug.
   - `.nearest-retailer`/`.nearest-label`/`.nearest-name`/`.nearest-price`/`.nearest-distance`/
     `.price-source-note` (used in `PriceSection.tsx`'s "Nearest" row) had **never** been
     defined in `index.css` at all — found while rewriting the file, not part of the original
     punch list. Added proper styles.
   - Two identically-named `@keyframes pulse` blocks existed in the original stylesheet (one
     for `.scan-spinner`, one for `.scan-price-loading-icon`) — the second silently overrode
     the first for every consumer, so `.scan-spinner`'s intended scale animation never actually
     ran. Renamed the second to `pulse2` and repointed its one consumer.
   - `backend/db/schema.sql`'s `tag_discovered` column read `DEFAULT 1`; CLAUDE.md documents
     the Phase 9.4 behavior as default `0` (harmless in practice — every insert path supplies
     an explicit value — but a real discrepancy for any future raw `INSERT`). Fixed the schema
     default and updated `db/migrate.test.ts`, which had asserted the stale `1`.
   - `.env.example`'s Serper comment still said "free tier 2500 queries/month" — superseded by
     CLAUDE.md §15's corrected billing record (one-time signup grant, now a paid Starter pack).
     Updated the comment.
   - `docs/CLAUDE.md`'s Modules table listed a SensorPush environment module as if shipped;
     zero code exists anywhere for it. Corrected to mark it not-yet-built (Phase 12), plus a
     new one-line note alongside the existing `ws_*` dead-column callout for `wines.appellation`
     (a second, previously-undocumented dead schema column).

7. **Manual verification pass** against the real `wine.db` (real `OPENAI_API_KEY`/
   `SERPER_API_KEY` present, so live enrichment was actually exercisable): all four tabs,
   search box, rating filter, manual **+ Add Wine** → Discovery Review (confirmed the draft
   badge fix) → Discard, the Evaluate flow end-to-end including the now-reachable tag-review
   step, Wine Detail modal (provenance markers, verification pills, Review Links label fix),
   `CellarStats`. Confirmed via computed styles that fonts/colors/badges render exactly as
   designed. Not exercised: Scan Label (no test image on hand — route itself is unchanged by
   this phase) and the guided retailer-search clipboard-confirm flow (needs real clipboard
   interaction). Both `npm test` (434 backend) and `npm run test:web` (131 web) pass clean
   after all changes. Two synthetic tasting notes created on the real "Raveneau" wine during
   live testing of the Evaluate-flow fix were deleted from the dev database afterward,
   restoring `latest_tasting_note_id`/`my_rating`/`my_tags`/`tag_consumed`/`date_first_consumed`
   to their pre-test (unset) state.

8. **Branch reconciliation** — already closed before this session started. `main` and
   `origin/main` were in sync (no divergence) at session start; Phase 10.5/10.6 were already
   merged. The "39 commits behind" gap this phase's `build-phases.md` entry references was
   resolved prior to this work.

## Key decisions

- Critic-score display prioritization stays **not implemented** — see #1. This reverses
  nothing; it just corrects which of the two Phase 10 feedback items was actually still open.
- The GPT-inferred/raw-fact marker only applies to the two wine-level fields with real
  `_source` provenance (`vintage_rating`, `drinking_window`) — not to per-citation critic-score
  attributes, which are raw extracted facts by design, never inferred.
- `RetailerPrice.verification` reuses the existing `.pill` primitives rather than a new badge
  component — first genuinely reusable instance of that pattern in this stylesheet.

## What's next

- The scan-triggered auto-fire path and guided retailer-search clipboard flow weren't
  exercised live this session (see #7) — worth a follow-up pass with developer go-ahead to
  spend live Serper/GPT-4o credits, similar to the note in the 2026-08-19 session.
- `EvaluateForm.test.tsx` doesn't exist — the bug in #5 would have been caught by even a
  shallow render test asserting the tag-review step appears after save. Worth adding, not
  done here (out of scope — this phase is verification/design application, not new test
  authoring beyond what regressions require).
- Old stored `price_data` blobs (fetched before the `verification` field existed) don't carry
  it at all — `PriceSection`'s new pill silently renders nothing for those, which is correct
  behavior, but a full re-fetch would be needed to backfill it, and that costs real Serper
  credits per the metered-cost design principle (CLAUDE.md §15) — not done unprompted.
