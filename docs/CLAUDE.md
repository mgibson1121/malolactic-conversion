# CLAUDE.md — Technical Context
> Wine app project | Placeholder name: [APP_NAME] | Last updated: 2026-09-04
> This file is the technical counterpart to `wine-app-product-context.md`. Read both before making any architectural or implementation decisions.

---

## 1. Project Overview

A personal wine companion app with two frontends (iOS and web) sharing a single local backend. There is no hosted infrastructure. The developer is the primary user; a small number of additional users may be added later. Scalability and multi-tenancy are explicitly out of scope.

---

## 2. Repository Structure

Monorepo. All code lives in a single repository. Capabilities are implemented as isolated modules — each with its own interface — but deployed together. Do not scaffold separate services or Docker containers.

```
/
├── backend/          # Local API server (Node.js / Express)
│   ├── modules/      # One directory per capability (see section 5)
│   ├── db/           # SQLite schema, migrations, seed data
│   ├── sheets/       # Google Sheets adapter (Phase 1 only — retained for reference)
│   └── server.ts     # Entry point
├── ios/              # Swift iOS app (Xcode project)
├── web/              # React web app
├── shared/           # Shared types, constants, validation schemas, retailer config (Phase 7+)
├── docs/
│   ├── product-context.md   # Product PRD — source of truth for features
│   └── specs/               # Per-feature spec files (added as features are built)
├── .github/
│   └── workflows/           # GitHub Actions CI workflow files
├── .env.example      # Template — never commit .env
├── .env              # Local secrets — gitignored
└── CLAUDE.md         # This file
```

---

## 3. Build Phases

Phases 1–4.5 are complete. The wine entry schema was validated against real data using a Google Sheets backend. The canonical schema is the additive boolean tag model described below — this supersedes any earlier status-enum design.

### Schema decisions locked after Phase 4.5

- Wine identity uses `producer` + `denomination` + `vintage`. `name` has been removed from the schema. Do not add it back.
- Status is expressed as four additive boolean tags on the `wines` table: `tag_discovered`, `tag_wishlist`, `tag_cellar`, `tag_consumed`. Tags are not mutually exclusive — a row can have multiple set to true simultaneously. Do not add a `status` column.
- **`tag_discovered` is not set automatically (Phase 9.4).** Its column default is `0`. Every creation path ends at the discovery review screen, where the user picks at least one list tag and presses Save to Collection. Do not reintroduce a default-on-creation tag anywhere.
- **`promoted_at` (ISO timestamp, nullable) is what "in the collection" means (Phase 9.4).** `NULL` = draft: written to the database so enrichment has a row to attach to, but excluded from every list, count and query, and swept 24 hours after `date_added` if never promoted. `listWines` filters `promoted_at IS NOT NULL` unless `WineFilter.include_drafts` is set; `getWine(id)` returns drafts. Draft-ness is deliberately **not** encoded as "all tags false" — that makes an abandoned scan indistinguishable from a wine the user deliberately removed from every list, which defeats the sweep. Do not collapse the two.
- `cellar_quantity` is an integer column on the wine entry. Default 0. Do not derive it from any other field.
- `latest_tasting_note_id` (UUID, nullable) on the wine entry points to the most recent `tasting_notes` row for that wine. Updated on each note save.
- `tasting_notes` rows include `wine_id` (UUID, not null), `date` (timestamp), and all WSET fields. Multiple rows per wine are supported.
- `drinking_window_start` / `drinking_window_end` are cached/derived values — overwritten by review data, never manually set.
- `my_tags` must stay in sync with tags extracted from `tasting_notes`; GPT-4o writes back to the wine entry when a note is saved.
- The wine entry uses a Tier 1 / Tier 2 field split. Tier 1 fields are canonical and expected on every entry. Tier 2 fields (`quality_classification`, `vineyard`, `cuvee`, `grape_varieties`) are nullable. See `wine-app-product-context.md` Section 3 for full definitions before building the label scan module.
- `cellar_category` (`table` / `near_term` / `long_term`) is a reserved field, same treatment as `expert_reviews` and `community_sentiment` below — see the Phase 9.3 note. It is not read or displayed anywhere in the shipped UI, and as of Phase 9.3 is no longer collected at wine creation either. Leave the column and type in place; do not remove without a separate decision.
- `wine_color` (Phase 10.5, `'red' | 'white' | 'rosé' | null`) is a Tier 2 field on the wine entry — same nullable-by-design treatment as `quality_classification`, no provenance/`*_source` column. Populated by label-scan extraction from explicit label cues only (never inferred from `grape_varieties`, which is unreliable for this — many grapes can be vinified more than one way) and overridable via `PATCH`.
- `app_settings` (Phase 10.5) is a new singleton table — one row, `id = 1` enforced by a CHECK constraint — holding app-level (not per-wine) config. Currently just `cellar_capacity: number | null`, a user-set total bottle-slot count the Cellar tab's capacity stat divides into. Exposed via `GET`/`PUT /api/settings` (`backend/routes/settings.ts`), not `wines.ts` — it isn't a per-wine resource.
- `GET /api/wines` accepts a `q` query param (Phase 10.5) — a plain `LIKE '%...%'` substring match across `producer`/`denomination`/`vineyard`/`cuvee`, combined with whatever tag/rating filter is already active. `WineFilter.include_drafts` — which already existed in `shared/types.ts` and the storage layer — is now actually wired into this route; it previously wasn't, so there was no way to call the API and get drafts back at all.

### Phase 5 — SQLite migration
Schema is validated. Replace the Google Sheets adapter with SQLite. No feature behaviour changes.

- Use `better-sqlite3` (synchronous — do not introduce async database patterns)
- Schema and migrations in `backend/db/`
- Storage adapter interface (`backend/modules/storage/`) must not change — only the implementation swaps
- Google Sheets adapter retained in `backend/sheets/` but no longer in the active code path
- All Phase 1–4 tests must pass identically against SQLite before this phase is closed

### Phase 6 — Price enrichment
Serper.dev (organic + Shopping) + Puppeteer. Populates a single `price_data` JSON column (`price_min`/`price_avg`/`price_max`/`retailers`/`nearest_retailer` are keys inside it, not separate SQL columns) plus `retailer_links`. A dead migration (`ws_price_min` etc., from an earlier Wine-Searcher-based design) exists in the DB but is never read/written by the adapter — don't build against it. **Phase 9.3 note:** that same Wine-Searcher-era language had also leaked into live UI copy and code comments in `LabelScanFlow.tsx`, `WineCard.tsx`, and `WineDetailModal.tsx` — retired as part of Phase 9.3, since the actual price source has been Serper since this phase. Full detail in `docs/build-phases.md`.

### Phase 7 — Review & critic score sourcing (current)
Separate module from pricing — locates a real retailer *product* page (not a search-results page) via Serper's organic `/search` endpoint with a `site:`-restricted query, renders it with Puppeteer, and runs GPT-4o extraction (moved from the price module, where it was dead code) to pull attributed critic scores into a new `review_data` column. Extraction windows the rendered page (`keyword-window.ts`, decided 2026-07-24 after live testing showed a blind 80K-character truncation was discarding review content on real product pages) around a generic, publication-agnostic score-citation pattern rather than sending the full rendered page to GPT-4o — cheaper per call and more robust to page size than a fixed truncation limit, and it captures any attributed score, not just ones from a pre-known list. `critic-keywords.ts` is applied only after extraction, to canonicalize a recognized publication's name and flag it `known_publication: true`/`false` — it never gates whether a score gets captured. That lookup is living config, expected to need periodic updates as critics change publications, but a miss there is now low-stakes (unnormalized name, not a dropped score). K&L is a known gap (bot-blocked at the product-page render, not just search) and is not pursued via bot-detection evasion. Full detail is in `docs/build-phases.md`.

### Phase 7.1 — Retailer search query genericization (price + reviews) — RETRACTED, no bug confirmed
First attempt at diagnosing a reported retailer-search failure tested the wrong code path (`price/retailer-search-url.ts`) and found nothing wrong there — correctly. See Phase 7.2 for where the real bug actually was.

### Phase 7.2 — Guided retailer search with confirmed-URL extraction (current)
The real bug: the "Find Reviews" button's search URL is built by `backend/modules/retailer-links/index.ts` — a third independent copy of query-building logic (distinct from `price/` and `reviews/`, each module keeps its own per §5) — and it includes the vintage, which returned zero results for Clos des Papes at Zachys even though a plain producer+denomination query works. Fix: drop vintage from that query, and layer a guided workflow on top — click search, find the product yourself, copy its URL, switch back to the app, which checks the clipboard for a matching-domain URL and offers to save it; saving triggers Puppeteer + GPT-4o extraction (price, vintage, critic scores — extending the existing Phase 7 pipeline) against that exact confirmed page, writing to both `price_data` and `review_data`. This is a fallback path for when Phase 7's automated discovery finds nothing for a retailer the developer trusts — automated results always take precedence when present. Full detail in `docs/build-phases.md`.

### Phase 8 — Professional review parsing extension
Extends the Phase 7 extraction pass (no new fetch) to also pull a per-critic drinking window, vintage character, and value/deal signal from the same rendered product page. Full detail in `docs/build-phases.md`.

### Phase 9 / 9.1 / 9.2 — Data review, identity matching remediation, enrichment cost reduction
A structured data-quality checkpoint (Phase 9) found stored critic scores attributed to the wrong wine and vintage; Phase 9.1 fixed the root cause with a single graded wine-identity matcher (`shared/utils/wine-match.ts`, `scoreMatch`) used everywhere identity is judged; Phase 9.2 brought per-wine Serper spend down (retailer review-search tiering, freshness/TTL guards with in-flight coalescing, negative-probe memory, on-click fallback-URL resolution) without narrowing retailer coverage. Full detail, decisions, and status in `docs/build-phases.md`.

### Phase 9.3 — Discovery review UI
The post-scan / post-add screen the developer actually sees first had not been touched since Phase 6.5 and had drifted out of step with Phases 7–9.2: it asked for a `cellar_category` nothing downstream reads, it auto-fetched only price (never reviews, the top-priority signal for deciding whether to keep a wine), the manual "+ Add Wine" path had no post-save screen at all, and it still carried Wine-Searcher-era copy. Rebuilds that one screen — reviews first (click-gated, reusing Phase 9.2's `useEnrichmentAction`/`fetchWineReviews` unchanged), then a preferred-retailer carry-check (frontend-only, computed from the existing price fetch, zero new Serper cost), then price, then an explicit wishlist/cellar decision — and unifies the scan and manual-add paths behind it. No new backend route or Serper call site. Full spec: `docs/specs/2026-08-16-phase-9.3-discovery-review-ui.md`. Full detail in `docs/build-phases.md`.

### Phase 9.4 — Scan-first enrichment and the draft/promote decision (current)
Phase 9.3 put reviews at the top of the post-save screen but left them click-gated, so the signal that decides whether a wine is worth keeping still arrived *after* the wine was in the collection. Two changes, together: the fetch moves earlier — price and the `primary` review tier fire automatically the moment GPT-4o label parsing returns, so verifying the parsed fields and waiting for the search are the same seconds — and the commitment moves later. A scanned wine is persisted immediately (enrichment needs an id) but is a **draft** until the user selects at least one list tag and presses **Save to Collection**; `tag_discovered` stops being automatic, drafts are invisible to every list and swept after 24 hours, and `DELETE /api/wines/:id` gives an explicit discard. Escalation beyond the primary tier (`extended`, merchant probes, open-web fallback) stays behind a click — the argument is latency and GPT-4o spend, not Serper credits (see §15's billing note). Adds a `tier` parameter to the existing `fetch-reviews` route; no new Serper call site. Full spec: `docs/specs/2026-08-19-phase-9.4-scan-first-enrichment.md`. Full detail in `docs/build-phases.md`.

### Phase 10 — UX design and prototyping
Design canvas pass (Claude Design skill, published as a Claude.ai Artifact) — not application code. Full detail in `docs/build-phases.md`.

### Phase 10.5 — Close UI/backend gaps (current)
A follow-up audit (`docs/specs/2026-09-03-phase-10-v2-backend-gap-analysis.md`) found the real backend and the real `web/src` frontend — both built incrementally since Phase 6.5, ahead of any formal design pass — had drifted from what the finalized Phase 10 design assumed: a route bug that silently broke a documented capability (`include_drafts` never read from `GET /wines`'s query params, see §5's note below), two schema fields the design depended on that didn't exist (`wine_color`, `cellar_capacity`), a missing search endpoint, and several UI affordances the backend already supported but no screen exposed (Discovered-tab quick tag chips, a Tasting Notes rating filter, a 3-state retailer link). This phase closes those gaps on both ends — new `wine_color`/`app_settings` schema (migrations `006`/`007`), the `q` search param, and the corresponding frontend wiring (search box, Cellar tab stat tile + region allocation bars via a new `CellarStats` component, Discovered-tab quick chips on `WineCard`, `RetailerViewLink`'s three link states). Also fixed in passing: `backend/jest.config.ts`'s `testMatch` excluded `db/` entirely, so `backend/db/migrate.test.ts` was never actually run by `npm test` or CI. Full detail in `docs/build-phases.md`.

### Phase 10.6 — Documentation catch-up after Phase 10.5
Documentation-only: Phase 10.5's own fifth deliverable (corrections to `wine-app-product-context.md` and the design-requirements doc's advice-capture reasoning) hadn't landed. Applied now — `wine_color` and the new settings mechanism are documented, `cellar_category` and community-sentiment read as resolved rather than open, and the advice-capture reasoning is corrected. No code changed. Full detail in `docs/build-phases.md`.

### Phase 11 and beyond
Defined in `docs/build-phases.md`.

---

## 4. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Backend | Node.js + Express + TypeScript | Local API server |
| iOS | Swift + SwiftUI | Native iOS app — primary capture surface |
| Web | React + TypeScript | Management and research surface |
| Database | SQLite via `better-sqlite3` | Phase 5 onward |
| Sheets adapter | Google Sheets API v4 via `googleapis` | Phases 1–4 only — retained for reference, not active |
| SERP data | Serper.dev | Shopping endpoint (Phase 6, price discovery) and organic `/search` endpoint (Phase 7, product page discovery for review sourcing) — different endpoints for different purposes; Shopping links are never trustworthy product URLs, organic links are. |
| Headless browser | Puppeteer | Phase 6: renders each retailer's search-results page to verify it still shows a result before its price is trusted (`verify-listing.ts`). Phase 7: renders a single confirmed *product* page (found via Serper organic search, not by rendering the retailer's own on-site search) for GPT-4o critic-score extraction. Do not run in CI; mock with HTML fixtures in tests. |
| Shared types | TypeScript interfaces in `/shared` | Used by both backend and web |
| Shared config | `shared/config/retailers.config.ts` (Phase 7) | Retailer slug/name/domain/coordinates/`reviewTier` (Phase 9.2). Moved from `backend/modules/price/` in Phase 7 because both `price` and `reviews` need it and modules cannot import from each other. |
| Shared query/matching utils | `shared/utils/wine-match.ts`, `shared/utils/retailer-search-url.ts`, `shared/utils/serper-client.ts` (Phase 9.2) | `normalize`/`significantWords`/`isRelevantMatch`/`buildDistinguishingQuery`, `buildRetailerSearchUrl`, and the single wrapped path to every outbound Serper call (call/attempt accounting, Phase 9.2 WI-1). Same reasoning as `retailers.config.ts` above. **Phase 9.1** replaced the boolean `isRelevantMatch` with a graded `scoreMatch` — see §5's note on wine identity. |

---

## 5. Modules

Each capability is an isolated module in `backend/modules/`. Every module exposes a consistent interface and can be developed, tested, and refined independently.

| Module | Directory | Responsibility |
|---|---|---|
| Label scanning | `modules/label-scan/` | GPT-4o vision → structured wine entry fields |
| Retailer links | `modules/retailer-links/` | Construct retailer search URLs from wine entry data; twelve retailers as of 2026-08-02 (see `shared/config/retailers.config.ts`). Reads `RETAILER_CONFIG` directly as of Phase 7.3. |
| Price enrichment | `modules/price/` | Serper.dev Shopping endpoint → price/retailer discovery (preferred retailers first, any relevant retailer as fallback capped at 5). Puppeteer renders each retailer's constructed search-results page and verifies it still shows results before trusting Serper's price (`verify-listing.ts`). Retailer list is config-driven and extensible; vintage mismatches and non-standard pack/bottle-size listings are flagged and excluded from aggregate price stats. Does not attempt critic-score extraction — see `modules/reviews/`. As of Phase 9.2, fallback retailer product-URL resolution moved from an unconditional part of this fetch to a one-credit, on-click action (`POST /:id/resolve-retailer-url`, WI-6). |
| Review & critic score sourcing | `modules/reviews/` (Phase 7, extended Phase 8, cost-tiered Phase 9.2) | Locates the correct single product page for a retailer via Serper's organic `/search` endpoint, tries progressively broader query variants (`findProductPageDetailed`), renders with Puppeteer, and runs GPT-4o extraction (`gpt-extract.ts`) into `review_data`. Phase 9.2 split the retailer list into `primary` (searched for every wine) and `extended` (only when the primary tier yields no critic score) tiers, skips domains in `UNRENDERABLE_DOMAINS` in the configured loop (not just fallback), and remembers per-wine `zero_results` probes (`review_probe_log`) for `NEGATIVE_PROBE_TTL_DAYS`. Open-web fallback (Phase 7.3) still runs when every configured retailer yields nothing. |
| Environment monitoring | `modules/environment/` | SensorPush Cloud API → temperature + humidity readings |
| Storage adapter | `modules/storage/` | Unified read/write interface; implementation swapped between phases |

Shared utilities:
- `shared/utils/proximity.ts` — Haversine distance calculation used to determine nearest retailer to NYC.
- `shared/config/retailers.config.ts` (Phase 7, tiered Phase 9.2) — retailer slug/name/domain/coordinates/`reviewTier`, used by both `modules/price/` and `modules/reviews/`.
- `shared/utils/wine-match.ts`, `shared/utils/retailer-search-url.ts` — query-building and relevance-matching primitives, used by `modules/price/`, `modules/reviews/`, and `modules/retailer-links/`. Do not reintroduce a per-module copy — see the file-level comment in `wine-match.ts` for the specific commits where duplication drifted before this consolidation.
- `shared/utils/serper-client.ts` (Phase 9.2) — the single wrapped path every outbound Serper call goes through; counts attempts (not just calls, since a `fetchWithRetry` retry is a billed request), attributed per-request via `AsyncLocalStorage`. A grep-based test asserts no other file calls `google.serper.dev` directly.

### Wine identity — one definition, one place (Phase 9.1)

`shared/utils/wine-match.ts` exports `scoreMatch(candidate, wine) → MatchVerdict`, which answers the four dimensions of wine identity — **producer, denomination, bottling, vintage** — separately, each as `match` / `mismatch` / `unknown`. It replaces the boolean `isRelevantMatch`, which is retained only as a thin wrapper for flat-text callers.

Rules that follow from it, all load-bearing:

- **Producer is judged on title + URL only, and every significant word must be present.** The snippet is excluded deliberately — body copy routinely name-drops other estates.
- **Vintage ranks and labels; it never rejects.** A shop whose only page for a wine is two vintages off still yields that page, with `vintage_gap` recorded.
- **No hard-coded vintage tolerance in the pipeline.** The gap is recorded; a single display-layer constant decides what renders as flagged.
- **Absence is `unknown`, never `mismatch`.**
- **The verdict is stored on the result** (`RetailerReview.match`, `RetailerPrice.vintage_verdict`) — callers read it rather than re-deriving it.
- **Two queries, not one.** The vintage belongs in a relevance-ranked Serper query and must never reach a retailer's own literal on-site search.
- **`VerificationState` is three-valued.** "Couldn't check" is not spelled the same way as "checked and confirmed."

Rules for all modules:
- Each module has its own `index.ts`, types file, and test file
- Modules do not import from each other — they communicate via the backend router only. Where two modules genuinely need the same data or logic, it belongs in `shared/`. The bar is "would a fix here need to be manually re-applied elsewhere?" — if yes, it belongs in `shared/`.
- Each module must degrade gracefully if its API key or credential is not configured (return null or empty state, never throw uncaught errors)
- `RETAILER_CONFIG` (in `shared/config/retailers.config.ts`) is a hand-curated allowlist, not a discovered list — a retailer missing from it produces an empty result indistinguishable from "searched and found nothing."
- Modules communicate through `backend/routes/wines.ts`, and as of Phase 9.1 that includes cross-feeding their discoveries: a product page `reviews/` confirmed is evidence for `price/`, and a retailer `price/` discovered is a search target for `reviews/`. Keep this coupling in the router — do not add a cross-module import.

**Frontend enrichment mechanism (Phase 9.2, `web/src/hooks/useEnrichmentAction.ts`):** `WineCard` and `WineDetailModal` both drive their Fetch/Refresh Price and Fetch/Refresh Reviews buttons through this one hook — busy/error/cached state, TTL-aware, `force`-bypassable. **This is the only enrichment mechanism in the app.** Any new surface that needs to fetch price or reviews (e.g. Phase 9.3's discovery screen) must reuse it rather than writing a parallel `useEffect`-based fetch, which is what the pre-Phase-9.3 post-scan screen did for price only and is exactly the kind of duplication this hook was extracted to stop.

---

## 6. API Key Management

### iOS
All credentials stored in iOS Keychain. Never stored on device filesystem or transmitted to backend.

### Web + Backend
All credentials stored in a local `.env` file at the project root.

- `.env` is gitignored — never commit it
- `.env.example` is committed with all required variable names and empty values — keep it up to date
- Load with `dotenv` in the backend entry point
- Claude Code must reference `.env.example` to know what keys are expected — never read `.env` directly

Required `.env` variables (`.env.example` template — all values empty):
```
OPENAI_API_KEY=
SERPER_API_KEY=
SENSORPUSH_EMAIL=
SENSORPUSH_PASSWORD=
GOOGLE_SHEETS_CREDENTIALS=
GOOGLE_SHEETS_SPREADSHEET_ID=
```

The `GOOGLE_SHEETS_*` variables are Phase 1–4 only. They can be left empty from Phase 5 onward. `SERPER_API_KEY` is used by both `modules/price/` (Shopping endpoint) and `modules/reviews/` (organic search endpoint, Phase 7) — one key covers both.

`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` were removed 2026-07-28 — the Reddit-based community layer they supported was retired.

---

## 7. Label Scanning

- Model: GPT-4o vision, high detail mode
- Images must be resized to max 1024px on the longest side before the API call
- Output: structured JSON covering all Tier 1 and Tier 2 wine entry fields. `name` is not in the schema — do not include it in scan output.
- **Phase 3 capture surface:** web file upload (HTML file input, image/*).
- **Phase 11 capture surface:** native iOS SwiftUI camera (AVFoundation). The backend module does not change.
- Estimated cost: ~$0.004 per scan at 1024×1024
- Key: `OPENAI_API_KEY` from `.env` (web/backend) or iOS Keychain (iOS)
- **Note (Phase 9.3):** the scanned image itself is never persisted — `label_image_url` is hardcoded `null` in every `CreateWineInput` built by the web frontend as of this writing. The on-screen preview during scan review is a same-session `URL.createObjectURL`, not a stored asset. If persisting the image becomes a goal, that's a separate decision — don't assume it already happens.

---

## 8. LLM Usage

- Model: GPT-4o for all LLM tasks (label scanning, tasting note tag extraction, critic score extraction, drinking window / vintage character / value-signal extraction)
- Do not use GPT-4 Turbo or GPT-3.5
- Key: BYOK — user supplies their own OpenAI API key
- Fallback: if no key is configured, features that require LLM degrade gracefully

---

## 9. Performance Targets

- Label scan → populated wine entry card: under 30 seconds end-to-end
- Price fetches and review/critic-score sourcing are async / background — they populate the wine entry card after the initial scan result is shown, and (as of Phase 9.2) reviews are click-gated, not automatic

---

## 10. Offline Behaviour

Offline mode is out of scope for v1.

---

## 11. Testing and CI

- Test-driven development is followed for all new features
- Each module has unit tests co-located in its directory (`*.test.ts`)
- Integration tests live in `backend/tests/integration/`
- Use Jest for the backend, Vitest for web; XCTest for iOS
- All tests must pass before merging to `main`
- Backend `testMatch` (`backend/jest.config.ts`) covers `__tests__/`, `tests/`, and `modules/**` — a test file placed outside all three (e.g. directly in `backend/db/`) will not run under `npm test` or CI without an explicit pattern added for it (found 2026-09-03: `backend/db/migrate.test.ts` had silently never run since it was written; fixed by adding a `db/**` pattern rather than moving the file). Both web (`tsconfig.json`, no `exclude`) and backend (`tsconfig.json`, `exclude: ["**/*.test.ts", ...]`) type-check differently — web's CI `tsc --noEmit` step does check test files, backend's does not; a type-only-caught bug in a backend test file will surface only when `jest`/`ts-jest` runs it, not from `tsc` alone.

### GitHub Actions (CI)

CI workflow lives in `.github/workflows/ci.yml`, running on every PR and push to `main`: install → lint (`tsc --noEmit` + ESLint) → backend tests (`jest`) → frontend tests → build.

---

## 12. Frontend Prototyping

**All planning, design, and execution happens inside Claude — no external tools.** This project is deliberately run end-to-end through Claude products (Claude.ai / Cowork for planning and UI design, Claude Code for filesystem execution and PRs) rather than handing design or implementation off to a separate tool. That choice is itself part of the project's purpose: it is as much an exercise in learning to use Claude well across a full build as it is about shipping a wine app. Do not introduce Magic Patterns, Cursor, Figma, or any other external design/build tool without an explicit developer decision recorded here first.

**Design method (updated 2026-08-25, Phase 10):** UI screens are designed as a multi-artboard canvas built with Claude's Design skill and published as a Claude.ai Artifact — not prototyped in Magic Patterns. The original Phase 10 plan named Magic Patterns before any UI design work had started; it was dropped without ever being used, and Phase 10 as originally written is superseded (see `docs/build-phases.md`). The canvas is iterated in place: the developer leaves comments directly on the published design, and a later session re-reads the artifact, addresses the comments, and republishes — no export/handoff step. Most UI before Phase 10 (since Phase 6.5) was built directly against product-context.md and iterative developer feedback with no prototyping step at all; Phase 10 is the first phase with a dedicated design pass.

---

## 13. Git Workflow

### Identity
```bash
git config user.name "Matt Gibson"
git config user.email "mjgibson1121@gmail.com"
```

### Remote
GitHub repository: https://github.com/mgibson1121/malolactic-conversion

All work is pushed to the remote. Do not leave branches local-only.

### Branching
```
feature/<short-description>     # New user-facing feature
service/<short-description>     # Core technical module or integration
fix/<short-description>         # Bug fix
chore/<short-description>       # Refactoring, dependency updates, config changes
```

All work happens on a branch. Merge to `main` only when CI is green.

**Exception: documentation-only commits.** `CLAUDE.md`, `build-phases.md`, `wine-app-product-context.md`, and files under `docs/specs/` and `docs/sessions/` may be committed directly to `main`, no branch or PR required — this is the mechanism §14's "Planning document commits" section depends on. The branch/PR/CI flow above is for code. A commit that touches both code and docs still goes through the normal branch/PR flow; only doc-only commits skip it.

### Pull requests
Every phase or discrete unit of work is delivered as a pull request. Title follows `<type>: <description>`. Description covers what changed, why, and decisions made. Link the relevant `docs/build-phases.md` phase. All CI checks must pass before merge. Squash merge. Claude Code opens the PR but does not merge it.

#### Documentation delta — required on every PR (added 2026-08-19)

Before opening a PR, re-read `CLAUDE.md`, `wine-app-product-context.md`, and the phase's spec **against the diff being proposed**, and fix whatever the change has made untrue. The PR description carries a **`## Documentation impact`** section, which is either a list of the doc commits included or an explicit *"None — no documented behaviour, constraint, field, or number changed,"* which is a claim being made, not a box being ticked. A PR that changes documented behaviour and claims no documentation impact should be treated as incomplete.

This is not the same check as §14's end-of-session file sync. That one asks "has a doc file changed and gone uncommitted." This one asks "has the *code* changed such that a doc is now wrong" — a question that has a different answer, because the failure mode is a doc that was never edited at all, and so produces no diff to notice.

**Triggers.** Any of these in a diff means at least one doc needs an edit in the same PR:

- a schema change — new column, changed default, changed nullability, a new migration
- a new, removed, or renamed route, or a new parameter on an existing one
- a changed default anywhere the docs state one (TTLs, tiers, caps, limits, concurrency)
- a change to metered-call arithmetic — per-wine call counts, tiering, a new guard, a new fallback pass
- a fact about an external service that turned out to be wrong (pricing, quota, API availability, ToS)
- an approach tried and rejected, where the *reason* is worth more than the attempt
- a decision that supersedes an earlier documented one — say so in the earlier place too, do not silently overwrite it

**Ownership — write it in the right file, not just in the nearest one:**

| Doc | Holds | Test |
|---|---|---|
| `CLAUDE.md` | Rules an agent must obey before writing code: constraints, module boundaries, schema invariants, cost discipline | *Would getting this wrong make the next agent build the wrong thing?* |
| `wine-app-product-context.md` | Product decisions, field semantics, why the app behaves as it does, source evaluations | *Would the product owner want this on record?* |
| `docs/build-phases.md` | The narrative record — what each phase did, in sequence | *Is this "what happened"?* |
| `docs/specs/<date>-<phase>.md` | The plan for one phase, including what was ruled out and why | *Is this "what we intend to do"?* |

Duplicating a decision across files is fine and often correct; leaving it in none of them is the failure.

### Commit message conventions
```
<type>: <brief description>
```
Types: `feat`, `service`, `fix`, `test`, `refactor`, `chore`, `docs`.

### Commit cadence
Multiple small, focused commits per phase, not one large commit.

---

## 14. GitHub Activity

Commit frequently with meaningful messages. Every phase produces at least one PR with a substantive description. `docs:` commits are real commits. Test commits are visible and signal discipline.

### Planning document commits

`CLAUDE.md`, `build-phases.md`, and `wine-app-product-context.md` are committed to the repo and treated as living documents — the canonical source of truth, not the copies held in Claude.ai project context. The repo is always authoritative.

**Roles (added 2026-09-04).** Project planning and strategy — build-phase design, requirements refinement, product-context decisions — happens in Claude AI (the Cowork session attached to this project's Claude.ai Project). Claude Code is execution-focused: it implements against the docs as written and should not need to re-derive or re-confirm decisions already recorded in `CLAUDE.md`, `wine-app-product-context.md`, or `docs/build-phases.md`. If a question Claude Code would otherwise ask the developer is already answered in one of those three files, read the file rather than asking again.

Both Claude AI and Claude Code have git write access to this repo and both commit documentation directly to `main` (see §13's documentation-only exception to the branch/PR flow). Claude AI is the primary source of new planning documentation and pushes doc updates directly to `main` as part of the same session that produces them, rather than holding them only in Claude.ai project context. Claude Code may still discover things mid-build worth documenting — a rejected approach, a measured number, a constraint hit — and should commit those directly too, per the Documentation delta and Conversational drift rules above; it is not required to route doc updates through Claude AI first.

Because the repo is authoritative, the Claude.ai project context copies exist only for convenience — so a Claude AI session doesn't have to open the repo to answer a question — and are synced *from* the repo, never the other way around. A Claude AI session doing planning work checks for drift against the repo at the start of the session, and re-syncs its project-context copies immediately after any doc commit it makes.

(**Note, 2026-08-16:** the Claude.ai project copies of this file and `wine-app-product-context.md` had drifted significantly — describing Phase 1/2-era Google Sheets/Wine-Searcher/Reddit/status-enum design well after the repo had moved through Phase 9.2. Synced back up as part of Phase 9.3's documentation work.)

(**Note, 2026-09-04:** the gap above recurred in a sharper form. A Claude AI session drafted Phase 10.5 as backend-only and held it in Claude.ai project context without pushing it to the repo, while a separate Claude Code session — working from the same original requirements but unable to see that draft — built a materially different (backend + frontend) implementation directly against the repo and merged it as PR #30. Neither side knew about the other's version until the developer's review surfaced the discrepancy. Reviewed and reconciled as Phase 10.6. The Roles section and direct-push workflow above exist specifically to prevent this recurring — the fix is Claude AI publishing to the same repo Claude Code reads, on the same cadence, not a better manual sync habit.)

### Conversational drift — write decisions back to the docs (added 2026-08-19)

The section above catches a doc file that changed and was not committed. It does not catch the more common loss: a long back-and-forth in a Claude Code session where the approach is argued out, corrected, narrowed, and settled **in conversation**, the code is written to match, and nothing is ever written down. No file diverges, so every sync check passes clean — and the reasoning evaporates when the context window closes. The next session re-derives it, or worse, re-litigates it and lands somewhere else. Iteration is where the real decisions get made; treat the transcript as a source that has to be harvested, not as scaffolding to discard.

**At the end of any session with substantial back-and-forth, re-read the session's own turns before writing the summary**, and pull out anything that changed what the project believes. Signals to scan for:

- the developer overriding, redirecting, or correcting a proposed approach — *"actually, let's…"*, *"don't do X"*, *"that's not what I meant"*
- an option considered and rejected, and the reason it lost. A rejected alternative is worth more than the chosen one; without it, the next session proposes it again
- a number that got **measured** rather than estimated, replacing a guess already written down
- an external fact that turned out to be wrong (this section exists partly because "Serper free tier: 2,500 queries/month" survived nine phases of cost reasoning built on top of it)
- a constraint discovered mid-build — a bot block, a rate limit, an API that does not exist, a library that does not do what its docs claim
- a decision that quietly reversed a documented one. Reversals must be recorded **at the original claim** as well as the new one, or the docs will hold two contradictory rules with nothing marking which won

**Where it goes.** A durable decision goes in `CLAUDE.md` or `wine-app-product-context.md` per the ownership table in §13. A session summary is a **log, not a source of truth** — an agent reading `CLAUDE.md` before building will not find it there. If a decision is recorded only in `docs/sessions/` or only in a code comment, it is effectively lost; the summary should link to the doc that now carries it, not substitute for it.

**Where the doubt should fall.** Doc churn is cheap and a stale doc is expensive — this project has already paid for one multi-phase drift (§14 above) and one wrong external fact. When unsure whether something is worth writing down, write it down. When unsure *where*, write it in the most binding place (`CLAUDE.md`) and cross-reference from the others.

### Session summaries

Written to `docs/sessions/<YYYY-MM-DD>-<phase-or-topic>.md` at the end of every coding session: what was done, key decisions, bugs found/fixed, PR link, what's next. Committed with a `docs:` commit as the final commit before opening the PR. Write it **after** the drift pass above, and have each key decision point at the doc that now holds it — a decision that lives only here has not actually been recorded.

---

## 15. Constraints — Read Before Building

These are hard constraints. Do not violate them without explicit instruction.

- Do not store API keys, credentials, or secrets in the database, in code, or in version control
- Do not build a hosted backend or cloud database — everything runs locally
- Do not use Postgres — use SQLite (Phase 5+) or Google Sheets (Phases 1–4, reference only)
- Do not scrape CellarTracker or WineBerserkers — both prohibit automated access in their ToS
- The retailer links module (Phase 6.6) constructs URL strings only — it never fetches or parses retailer pages.
- Before treating a retailer as off-limits for automated access, check that retailer's own `robots.txt` on the actual host being used. A live block from bot detection is a technical problem to route around; an explicit ToS/robots.txt prohibition is not.
- Do not blend or synthesise data across sources — each data source speaks in its own voice on the wine entry card
- Extraction from third-party review/retail text must produce structured facts only — scores, dates, enum values, booleans. Never store or reproduce source prose (copyright boundary). Store the source URL instead.
- Do not add microservice infrastructure — modular code in a monorepo is sufficient
- Do not build multi-user authentication — v1 is single user
- Do not merge a PR while CI is red
- Do not add a new retailer, query variant, fallback pass, or per-item probe that multiplies outbound Serper calls without stating the calls-per-wine cost before and after — see "Metered-API cost is a design constraint" below

### Metered-API cost is a design constraint (Phase 9.2, 2026-08-12)

Serper is billed per request, and it is the one dependency whose cost scales with **configuration** rather than with usage. Adding a retailer to `RETAILER_CONFIG` is a one-line change that permanently raises the price of every future wine enrichment, because `modules/reviews/` searches the whole list and issues up to four query variants per entry. That is how per-wine review sourcing reached ~38 credits across Phases 7.3–8 without anyone deciding it should: the list went 4 → 11 → 12, each step individually reasonable, and the multiplication was never written down.

Treat outbound metered calls the way the rest of this document treats data correctness — as something with a stated design, not something that emerges.

- **State the arithmetic before adding fan-out.** Any change that multiplies outbound search calls — a new retailer, a new query variant, a new fallback pass, a new per-item probe — must give calls-per-wine before and after, in the spec or the PR description. "One more retailer" is not a cost estimate; "12 → 13 entries × ~3 variants = +3 per wine, permanently" is.
- **Prefer escalation over breadth.** Ask the cheap, well-aimed question first; pay for the broad one only when the first comes back empty. `fetchReviewData`'s existing gate — `!results.some(r => r.critic_scores.length > 0)` — is the pattern to reuse rather than reinvent, so every escalation in the pipeline shares one definition of "found nothing."
- **Never buy the same answer twice.** A result already computed elsewhere in the run should be fed across (the Phase 9.1 router cross-feed), and a result already stored should not be re-fetched without an explicit refresh. Cheap local evidence beats a paid call: check `UNRENDERABLE_DOMAINS`, `attemptedDomains`, and `isNonProductUrl` *before* spending, not after.
- **Keep cost guards and access decisions separate.** A domain skipped because it cannot be rendered is a technical fact; a domain skipped because it rarely pays off is a product judgement; a domain skipped because its ToS forbids access is a hard constraint (the CellarTracker/WineBerserkers bullets above). Three different mechanisms, never collapsed into one flag — collapsing them produces config that lies about why something was excluded.
- **Latency is not the metric.** §9's targets are about the developer waiting. A bounded-concurrency change can leave call volume identical while feeling faster; that is not a saving.
- **Enrichment stays user-initiated, with one named exception.** No background refresh, no scheduled re-fetch, no enrichment fired because a screen loaded — fixed by Phase 9.2, reaffirmed by Phase 9.3. **Phase 9.4 (2026-08-19) carves out exactly one exception, and its boundaries are the point:** on the *scan* creation path, after a *free* local duplicate check, for a wine whose Tier 1 fields all parsed, price and the **`primary` review tier only** are fired once, automatically, at the moment label parsing returns. Not the extended tier, not the merchant probes, not the open-web fallback — those stay behind a click. Not the manual `+ Add Wine` path. Not a second time. Anything broader than that sentence is a new decision requiring its own arithmetic, not an extension of this one.

### Serper billing state (updated 2026-08-19)

Recorded here because every cost argument in this repo has been made against a number that was wrong. The free allowance was **2,500 credits one-time on signup — not per month** — and it is **exhausted**. The project is on its **first $50 Starter pack: 50,000 credits, expiring six months from purchase** (developer-confirmed 2026-08-19). There is no smaller pack.

The consequence is counterintuitive and should be stated plainly before the next optimisation. At ~10 credits per scanned wine and 20–50 scans/month, the pack holds roughly **five years** of runway but is forfeited at six months, so ~90% of it will expire unspent. **Effective cost is therefore a flat ~$8.33/month regardless of per-scan thrift, and a credit saved on one scan is not a dollar saved** until scan volume is roughly 10× higher. The $5/month target is unreachable by any change to this application — it is set by pack shape, not by usage. Only a provider with smaller packs or without expiry could move it. The bullets below still hold — unbounded fan-out is still how the 4 → 11 → 12 retailer creep happened, and configuration cost still compounds silently — but an argument for spending fewer credits per wine should now be made on **latency, GPT-4o spend, or correctness** grounds. Those are per-call and have no prepaid pool absorbing them. If someone proposes a change justified purely as "saves Serper credits," that is not currently a benefit; ask what it costs in the other three.

**Raise it, don't just build it.** If a requested change adds a per-wine or per-request call to a metered API — or if you notice several such additions accumulating across a phase — say so before implementing, with the arithmetic, in a sentence or two. Then build it if the developer still wants it. This is a single-developer project paying retail for every call, and the failure mode to watch for is not one expensive feature but a series of individually reasonable ones. Gentle, specific, and early is the right register: flag the cost, propose the cheaper shape if there is one, and defer to the developer's call.

---

## 16. Open Technical Questions

- [ ] Serper Shopping coverage: continue verifying return quality across the wines actually in the collection
- [ ] Burgundy Report: ToS permits note reproduction for active subscribers with attribution; evaluate as a future addition
- [ ] Professional review APIs (Burghound, Vinous, Wine Advocate): confirmed no API for individual subscribers. Closed unless a viable path emerges.
- [ ] GPT-4o Mini: evaluate against GPT-4o for label scanning once volume justifies it
