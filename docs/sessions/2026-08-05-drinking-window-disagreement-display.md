# 2026-08-05 — Surfacing critic disagreement on drinking windows

Branch: `feature/attributed-drinking-windows`

## Context

`pickSingleAgreeing` in `backend/modules/reviews/derive-wine-level.ts` applies a unanimity rule to the two wine-level fields it derives: zero values leaves the field alone, exactly one distinct value is used, two or more distinct values yield `null`.

The concern raised was that unanimity inverts as review coverage improves — with 12 configured retailers plus the open-web fallback, more data would make the field *less* likely to populate.

## Premise check before deciding

Four premises in the brief did not match the repo. Two mattered:

1. **The unanimity check runs after a null filter** (`derive-wine-level.ts:60` and `:71`). Critics who state no value do not participate. Combined with `build-phases.md` line 906's finding — real citations are wine-specific tasting notes far more often than broad vintage assessments — the failure mode is narrower than described. A wine with 12 critic scores where one states a window and eleven state nothing derives cleanly from that one. Only 2+ critics *both* stating and disagreeing produces the null.
2. **The rate of that is unmeasured.** Nothing in the repo counts it.

Also noted and not acted on: `docs/sessions/2026-08-04-core-functionality-defect-taxonomy.md` does not exist and `RC-10` appears nowhere in the repo; there is no Phase 9.1 vintage gate in this worktree (no `match.vintage === 'match'` filtering, no 9.1 section in `build-phases.md`); and `pickSingleAgreeing` carries no `OPEN QUESTION` comment — its doc comment states the rule as settled and cites §15 as rationale.

## Decision

Options were laid out against §15 ("do not blend or synthesise data across sources"), which is documented in three places — `CLAUDE.md:348`, `wine-app-product-context.md:73`, `build-phases.md:172` — and backed by a named acceptance test at `build-phases.md:898`.

- **Majority/plurality** is synthesis — the value would be backed by no single critic's authority. Would require amending §15 in all three documents.
- **Weight by `known_publication`** is selection, not blending, so §15-compatible in letter; introduces an editorial hierarchy, which is a product judgment.
- **Most-recent-critic-wins is not implementable.** `CriticScore` (`shared/types.ts:19`) has no review date. The only timestamp is `RetailerReview.fetched_at`, which records when we fetched, not when the critic published.
- **Surface disagreement in the UI** — chosen. Fully §15-compatible, no doc amendment.

Developer chose: surface in the UI, attributed to each critic, on **both** the card and the detail modal, with the visual treatment to be settled during the UI build. Scope limited to `drinking_window`; `vintage_rating` deliberately left for later.

Notably, Phase 8 step 3 (`build-phases.md:887`) had already specified this display behaviour — "The UI (once built) is expected to show each critic's window/character distinctly ... rather than collapsing them into one number." This change implements an existing expectation rather than setting new policy.

## What changed

Frontend only. `derive-wine-level.ts` is untouched.

| Commit | Change |
| --- | --- |
| `feat: derive attributed drinking windows from review_data` | New `web/src/utils/drinkingWindows.ts` |
| `feat: show disagreeing critic drinking windows on card and detail` | New `AttributedDrinkingWindows.tsx`; wired into `WineCard` and `WineDetailModal`; baseline CSS |
| `test: cover attributed drinking window grouping and display` | 11 tests across helper, component, and card render branch |
| `docs: record the drinking-window disagreement display in phase 8` | `build-phases.md` note |

The wine-level field still wins whenever non-null, which also preserves manual overrides — `drinking_window_source === 'manual'` always implies a non-null field, so the fallback cannot fire over a hand-set value.

## Key implementation decisions

- **The completeness filter matches `deriveWineLevelFields` exactly** — both endpoints required. `CriticScoreBadges` uses a looser filter (`start != null || end != null`) to render half-open windows. Copying that would have let the UI claim disagreement over citations the backend never counted when it decided to null the field.
- **Scores are deduped by publication before grouping**, reusing `getDedupedCriticScores`. One critic syndicated across several retailers is one opinion, not agreement with itself.
- **Distinct windows are grouped, carrying all critics that stated them**, so three critics agreeing reads as one window with three names rather than three identical rows.
- **The disagreement note counts critics, not windows.** An earlier draft used `windows.length`, which would have reported "2 critics" for three critics spread across two windows. Covered by a test.

## Verification

- `npx vitest run` (web): **54 passed**, 11 of them new.
- `npx tsc --noEmit` (web): clean.
- `npx jest --forceExit` (backend): **213 passed, 4 skipped, 11 suites** — confirming the untouched derivation is unaffected.
- **Not verified in a running app.** There is no `backend/db/wine.db` in this worktree, so live verification would need a seeded database plus a fabricated wine with disagreeing critic windows. Coverage is jsdom-level only.

## Found, not fixed

**Pre-existing display bug adjacent to this work.** The wine-level field stores ISO date strings (`yearToIsoDate`, `derive-wine-level.ts:15`), but `WineCard.tsx:183` and `WineDetailModal.tsx:283` render them raw — so an agreeing wine currently reads `Drink 2029-01-01–2045-01-01`. The new attributed path renders bare years, matching `CriticScoreBadges`. This predates the change and was left alone, but the two will look inconsistent side by side once wines exist in both states. Worth a `fix:` commit on its own.

## What's next

1. Decide the visual treatment of disagreement during the UI build — current CSS is baseline legibility only.
2. Fix the ISO-date rendering of the agreed wine-level window (above).
3. Consider the same treatment for `vintage_rating`, which has the identical failure mode but where `null` is usually absence of data rather than disagreement.
4. **Measure the actual disagreement rate before reopening the derivation rule.** This change makes disagreement visible; it does not change fill rate. If empty fields on well-covered wines are still the complaint, that is a different problem and needs numbers first.

## PR

https://github.com/mgibson1121/malolactic-conversion/pull/17
