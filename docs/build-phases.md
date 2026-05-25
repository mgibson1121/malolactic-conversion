# Build Phases
> Wine app project | Placeholder name: [APP_NAME] | Last updated: 2026-05-25
> This file defines the incremental build sequence for the project. Each phase delivers a discrete, testable increment of value. Phases should be completed in order — later phases depend on earlier ones being stable.
> Read alongside `wine-app-product-context.md` (what to build) and `CLAUDE.md` (how to build it).

---

## Phase 1 — Schema definition (Google Sheets) ✅

**Goal:** Define and validate the wine entry schema against real data before building any UI or committing to a database. This is a data-only phase — no frontend, no external enrichment.

**Deliverables:**
- Wine entry schema defined as a Google Sheet with one tab per entity type: `wines`, `tasting_notes`, `advice`
- Schema reflects the Tier 1 / Tier 2 field split defined in `wine-app-product-context.md` Section 3. Tier 1 fields are canonical columns present on every row. Tier 2 fields (`quality_classification`, `vineyard`, `cuvee`, `grape_varieties`) are nullable columns — empty is valid. `name` is not a column — do not add it.
- The `wines` sheet uses four boolean tag columns: `tag_discovered`, `tag_wishlist`, `tag_cellar`, `tag_consumed`. Do not add a `status` column. Every new row defaults to `tag_discovered = true`. Lists are derived by filtering on these columns — there are no separate `cellar`, `wishlist` sheets.
- `cellar_quantity` integer column on the `wines` sheet. Default 0.
- `latest_tasting_note_id` column (UUID, nullable) on the `wines` sheet. Updated on each new note save. Null = no note recorded.
- `tasting_notes` sheet includes a `wine_id` column (UUID, not null) and a `date` timestamp column. Multiple rows per wine are supported — query by `wine_id` for full history, use `latest_tasting_note_id` for most recent only.
- `drinking_window_start` / `drinking_window_end` treated as cached/derived values — overwritten by review data, never manually set
- `my_tags` kept in sync with tags on the `tasting_notes` sheet; GPT-4o tag extraction writes back to the `wines` sheet when a note is saved
- Google Sheets storage adapter in `backend/sheets/` exposing a consistent read/write interface
- Manual entry via the backend API only — no UI at this stage

**Notes:**
- No external enrichment in this phase — all fields populated manually to validate the schema
- A free wine data API was evaluated at this stage and ruled out due to inconsistent data quality; GPT-4o label scanning (Phase 3) is the intended enrichment path
- The Sheets adapter must expose the same interface as the future SQLite adapter — no feature should assume a specific storage implementation

**Milestone:** Real wine entries exist in Google Sheets with both Tier 1 and Tier 2 fields populated from real bottles. The schema feels correct against actual data. Ready to build the POC UI.

---

## Phase 2 — End-to-end POC (skeletal web UI + Google Sheets) ✅

**Goal:** Validate two things in a single rough pass: (1) that the wine object can be created via a minimal UI and stored correctly in the Sheets structure, and (2) that the skeletal UI structure — the core lists a wine entry belongs to — is the right shape for the product. This is a proof of concept, not a polished feature. Speed of learning matters more than code quality at this stage.

**Deliverables:**
- Manual wine entry form: create a wine object by filling in Tier 1 fields (producer, vintage, region, denomination, cellar category). Tier 2 fields (quality_classification, vineyard, cuvee, grape_varieties) included as optional inputs. `name` has been removed — do not include it as a form field. New entries default to `tag_discovered = true`. No scanning or enrichment — user-supplied data only.
- Tag management UI: user can add or remove any of the four boolean tags (`tag_discovered`, `tag_wishlist`, `tag_cellar`, `tag_consumed`) from any wine entry at any time.
- List views: four filterable lists — Discovered, Wishlist, Cellar, Tasting Notes — each derived by filtering the wines sheet on the relevant boolean tag. A wine can appear in multiple lists simultaneously.
- Cellar list displays `cellar_quantity` alongside each entry. Quantity is adjustable inline without opening the full entry.
- Core list alignment proven: a single wine entry correctly appears in multiple lists when multiple tags are set.
- All reads and writes go through the Google Sheets adapter — no database yet
- Web UI only at this stage

**Notes:**
- This phase intentionally uses Google Sheets as the backend so schema changes remain cheap — a new column is a one-line addition, not a migration
- The UI is skeletal on purpose: layout and navigation structure are what's being validated, not visual design or interaction polish
- No external data fetching in this phase; all fields are user-supplied
- If the list structure or wine object shape feels wrong against real data, fix it here before moving to SQLite — that is the explicit purpose of this phase

**Milestone:** A wine entry can be created manually, stored in Google Sheets, and correctly displayed across multiple list views simultaneously via boolean tags. Tag management works. The schema and skeletal UI structure are validated and ready for the SQLite migration.

---

## Phase 3 — Label scanning ✅

**Goal:** Validate the full label scan pipeline — image intake, GPT-4o vision extraction, Tier 1/2 field population, and entry card review — without requiring a native iOS app. The intended production capture surface is the iOS camera (Phase 10); this phase proves the backend pipeline using a web file upload as a pragmatic stand-in.

**Deliverables:**
- GPT-4o vision label scan module in `backend/modules/label-scan/`
- Image resize pipeline: max 1024px on longest side before API call — applied regardless of input source
- Scan returns structured JSON covering all Tier 1 fields (producer, vintage, region, denomination) and Tier 2 fields (quality_classification, vineyard, cuvee, grape_varieties) where extractable. `name` has been removed — do not include it in scan output.
- Tier 2 extraction follows the rules defined in `wine-app-product-context.md` Section 3 — the label scan prompt must explicitly encode these rules, not infer them
- Web UI file upload: user selects or drops a photo of a wine label → scan runs → pre-populated entry card displayed for review → user confirms or adjusts → saves to Sheets
- End-to-end latency target: under 30 seconds from upload to populated entry card

**Notes:**
- The capture surface in this phase is a web file upload (HTML file input accepting image/*), not a native camera. This is intentional — the goal is to validate the scan pipeline, not the capture UX.
- The native iOS camera flow (SwiftUI, AVFoundation) is built in Phase 10. The backend label scan module does not change at that point — only the capture surface is swapped.
- Raw image input must always be resized to max 1024px before the API call — enforce this in the module regardless of how the image arrives (file upload now, camera later)
- Tier 1 fields that the scan cannot populate must surface a manual entry prompt in the UI — never silently omit
- Tier 2 fields that the scan cannot populate are left null — do not prompt the user unless they choose to edit
- If the OpenAI key is not configured, label scan is unavailable with a clear UI message; manual entry remains available

**Milestone:** A wine label photo uploaded via the web UI produces a populated entry card — with Tier 2 fields extracted where present — in under 30 seconds. The scan pipeline is validated and ready. iOS camera integration is deferred to Phase 10.

---

## Phase 4 — Evaluate (WSET tasting notes) ✅

**Goal:** Record a structured tasting note when consuming a wine. Complete the wine entry object with user-generated evaluation data.

**Deliverables:**
- WSET structured tasting note form with pre-populated options: appearance, nose, palate, conclusions
- Aroma tooltips on primary, secondary, and tertiary aroma fields (nose and palate only): an info icon adjacent to each aroma field label reveals a curated list of example descriptors. Tooltip content is defined in `wine-app-product-context.md` Section 7. Tooltips do not interrupt the form flow — they are opt-in and dismissable.
- Free text notes field
- Voice note upload and transcription via GPT-4o
- Tag extraction from completed notes via GPT-4o
- `my_rating` field: `poor` / `acceptable` / `good` / `very_good` / `outstanding` — aligns with WSET quality scale
- Tags surfaced on the wine entry card

**Association and navigation rules:**
- The Evaluate CTA is available from any list view a wine entry appears in, and from the wine entry creation confirmation screen. There is no tag gate — any wine can be evaluated at any time.
- On save, the tasting note is written to the `tasting_notes` sheet with a `wine_id` foreign key and a `date` timestamp. The `latest_tasting_note_id` on the wine entry is updated. `tag_consumed` is set to true automatically on first note save.
- After saving a note the user is prompted to review their list tags and add or remove any as appropriate. This replaces any "move to consumed" prompt.
- Multiple tasting notes per wine entry are supported. All notes retained. Most recent rating displayed in list views.

**UI notes:**
- HTML is sufficient for this phase — visual design and interaction polish deferred to Phase 10
- The `flawed` WSET conclusion indicates a technical wine fault and should trigger a distinct fault indicator — not treated as the lowest point on the `my_rating` scale

**Notes:**
- WSET framework is fixed in v1 — do not make it configurable yet
- Tag extraction requires the OpenAI key; if not configured, free text is saved without tags

**Milestone:** A tasting note can be initiated from any list view, saved, and linked to the wine entry. Tags are updated post-save. The wine object is complete for all list use cases.

---

## Phase 4.5 — List management and review access ✅

**Goal:** Complete the list interaction layer. Bottle count management, review access from any list, and the Tasting Notes list as a browsable surface.

**Deliverables:**
- Cellar list: `cellar_quantity` displayed per entry. Inline +/- controls to adjust quantity without opening the full entry.
- Review access from any list: any wine entry with a tasting note (`latest_tasting_note_id` not null) is clickable to open a review history screen showing all notes for that wine sorted by date descending.
- Review drill-down: from the review history screen, individual notes are selectable to view the full structured WSET fields.
- Tasting Notes list: a dedicated browsable list showing all wine entries where `latest_tasting_note_id` is not null, sorted by the date of the most recent note descending. Displays the most recent `my_rating` and WSET quality conclusion inline.
- Tag management accessible from any list view: user can add or remove any boolean tag from a wine entry without navigating away from the list.
- Evaluate CTA confirmed present in all list views for all wine entries regardless of tag state.

**Schema decisions locked in this phase — carried forward to all subsequent phases:**
- The `status` enum (`discovered → wishlist → cellar → consumed`) has been replaced by the additive boolean tag model. Do not reintroduce a `status` column.
- `cellar_quantity` is a direct integer field on the wine entry. Do not derive it from any other field or table.
- `date_first_consumed` replaces `date_consumed`. It is set once on the first tasting note save and never overwritten.
- `latest_tasting_note_id` on the wine entry is updated on every note save. The `tasting_notes` table supports multiple rows per wine.
- Wine identity is `producer` + `denomination` + `vintage`. `name` has been removed permanently.

**Notes:**
- HTML UI is sufficient — polish deferred to Phase 10
- The Tasting Notes list is read-only in this phase — it surfaces existing notes, does not initiate new ones (Evaluate CTA handles that)
- Bottle quantity and tag management are the two interactions most likely to surface schema edge cases — if any gaps are found, fix before proceeding to Phase 5

**Milestone:** Bottle quantity is manageable from the cellar list. Reviews are accessible from any list. The Tasting Notes list is browsable. Tag management works from all list contexts. Schema is stable. Ready for SQLite migration.

---

## Phase 5 — SQLite migration

**Goal:** Schema is validated against real data across Phases 1–4.5. Replace the Google Sheets adapter with SQLite. No feature behaviour changes — the app should behave identically before and after this phase.

**Branch:** `service/sqlite-migration`

**Deliverables:**

### 1. SQLite schema (`backend/db/schema.sql`)

**`wines` table**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | UUID — generated by application layer |
| `producer` | TEXT NOT NULL | |
| `denomination` | TEXT NOT NULL | Replaces `name` — do not add a `name` column |
| `vintage` | INTEGER | Nullable — null for NV |
| `region` | TEXT NOT NULL | |
| `appellation` | TEXT | Nullable |
| `quality_classification` | TEXT | Tier 2 — nullable |
| `vineyard` | TEXT | Tier 2 — nullable |
| `cuvee` | TEXT | Tier 2 — nullable |
| `grape_varieties` | TEXT | Tier 2 — nullable; stored as JSON array string |
| `label_image_url` | TEXT | Nullable |
| `tag_discovered` | INTEGER NOT NULL DEFAULT 1 | Boolean: 0 or 1. New rows default to 1. |
| `tag_wishlist` | INTEGER NOT NULL DEFAULT 0 | Boolean: 0 or 1 |
| `tag_cellar` | INTEGER NOT NULL DEFAULT 0 | Boolean: 0 or 1 |
| `tag_consumed` | INTEGER NOT NULL DEFAULT 0 | Boolean: 0 or 1 |
| `cellar_category` | TEXT | `table`, `near_term`, or `long_term` — nullable |
| `cellar_quantity` | INTEGER NOT NULL DEFAULT 0 | |
| `drinking_window_start` | TEXT | ISO date string — derived/cached, never manually set |
| `drinking_window_end` | TEXT | ISO date string — derived/cached, never manually set |
| `vintage_rating` | TEXT | `below_avg`, `avg`, `good`, `very_good` — nullable |
| `my_rating` | TEXT | `poor`, `acceptable`, `good`, `very_good`, `outstanding` — nullable |
| `my_tags` | TEXT | JSON array string — kept in sync with tasting note tags |
| `latest_tasting_note_id` | TEXT | UUID FK → `tasting_notes.id` — nullable |
| `wishlist_notes` | TEXT | Nullable |
| `price_paid` | REAL | Nullable |
| `purchased_from` | TEXT | Nullable |
| `date_added` | TEXT NOT NULL | ISO timestamp — set on insert |
| `date_first_consumed` | TEXT | ISO timestamp — set once on first note save, never overwritten |

**`tasting_notes` table**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | UUID |
| `wine_id` | TEXT NOT NULL | FK → `wines.id` |
| `date` | TEXT NOT NULL | ISO timestamp |
| `my_rating` | TEXT | `poor`, `acceptable`, `good`, `very_good`, `outstanding` — nullable |
| `wset_appearance_clarity` | TEXT | Nullable |
| `wset_appearance_intensity` | TEXT | Nullable |
| `wset_appearance_colour` | TEXT | Nullable |
| `wset_nose_condition` | TEXT | Nullable |
| `wset_nose_intensity` | TEXT | Nullable |
| `wset_nose_aroma_characteristics` | TEXT | JSON array string — nullable |
| `wset_palate_sweetness` | TEXT | Nullable |
| `wset_palate_acidity` | TEXT | Nullable |
| `wset_palate_tannin` | TEXT | Nullable — reds only |
| `wset_palate_body` | TEXT | Nullable |
| `wset_palate_flavour_intensity` | TEXT | Nullable |
| `wset_palate_finish` | TEXT | Nullable |
| `wset_conclusion_quality` | TEXT | `flawed`, `poor`, `acceptable`, `good`, `very_good`, `outstanding` — nullable |
| `free_text` | TEXT | Nullable |
| `extracted_tags` | TEXT | JSON array string — from GPT-4o tag extraction — nullable |

**`advice` table**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | UUID |
| `tip` | TEXT NOT NULL | |
| `source_role` | TEXT | `sommelier`, `friend`, `other` — nullable |
| `category` | TEXT | `producer`, `technique`, `region`, `value`, `other` — nullable |
| `wine_id` | TEXT | FK → `wines.id` — nullable; advice may not link to a specific wine |
| `date_added` | TEXT NOT NULL | ISO timestamp |

### 2. Migration runner (`backend/db/migrate.ts`)

- Reads and executes `schema.sql` against the SQLite file
- Idempotent — safe to run multiple times without error
- Database file path: `backend/db/wine.db` — gitignored

### 3. SQLite storage adapter (`backend/modules/storage/sqlite-adapter.ts`)

Implements the existing storage interface (`backend/modules/storage/interface.ts`). The interface must not change — only the implementation.

Adapter rules:
- All database calls are synchronous — `better-sqlite3` is sync by design. Do not introduce async patterns or Promises for database operations.
- The adapter is instantiated once and injected into the router. Do not create multiple database connections.
- JSON fields (`grape_varieties`, `my_tags`, `wset_nose_aroma_characteristics`, `extracted_tags`) are serialised to strings on write and deserialised on read within the adapter. The rest of the app always sees typed arrays, never raw strings.
- Boolean tag columns are stored as integers (0/1) in SQLite. The adapter serialises booleans on write and deserialises on read — the rest of the app never sees raw integers.
- `date_first_consumed` is set once on the first tasting note save for a wine and never overwritten. The adapter must enforce this.

### 4. GitHub Actions CI (`.github/workflows/ci.yml`)

Create the CI workflow file. It runs on every pull request and every push to `main`.

Pipeline steps:
1. `actions/checkout`
2. `actions/setup-node` (Node 20)
3. `npm ci` (root, backend, web)
4. `tsc --noEmit` (backend and web)
5. Backend tests: `npx jest` (unit + integration)
6. Frontend tests: `npx jest` (unit)
7. Build: `tsc` — confirm no type errors in final output

### 5. Adapter swap

In `backend/server.ts`, replace the Sheets adapter instantiation with the SQLite adapter. The Sheets adapter code stays in `backend/sheets/` — do not delete it — but nothing in the active code path imports or instantiates it.

### 6. Seed script (`backend/db/seed.ts`)

Inserts 3–5 real wine entries covering a spread of tag combinations (e.g. one cellar-only, one cellar + wishlist, one consumed with a tasting note). Used to verify the migration and smoke-test list views after setup. Not run in CI — developer runs manually via `npm run seed`.

**Notes:**
- `better-sqlite3` is synchronous — do not introduce async database patterns anywhere in the adapter
- Use an in-memory SQLite database (`:memory:`) for all test runs — do not write to `wine.db` during CI
- The storage adapter interface must not change — only the implementation swaps
- The Google Sheets adapter is retained in `backend/sheets/` for reference but is no longer in the active code path

**Tests:**
All existing backend (56) and frontend (22) tests must pass against the SQLite adapter with zero regressions.

Additional tests for this phase:
- `backend/db/migrate.test.ts` — verify the migration runs successfully against a fresh `:memory:` database
- `backend/modules/storage/sqlite-adapter.test.ts` — unit tests covering: insert, read, update, tag toggle, quantity update, tasting note save with `latest_tasting_note_id` update, and `date_first_consumed` set-once behaviour

**Suggested commit sequence:**
```
chore: add better-sqlite3 dependency
docs: add phase 5 schema tables to build-phases
service: add sqlite schema ddl
service: implement sqlite storage adapter
service: add migration runner
test: add sqlite adapter unit tests
test: add migration integration test
service: swap active storage adapter to sqlite
service: add seed script
chore: add github actions ci workflow
docs: update CLAUDE.md — mark sheets adapter as inactive
```

**PR:**
- Title: `service: sqlite migration — replace sheets adapter`
- Description must cover: what changed, schema decisions inherited from Phase 4.5, confirmation that all 56 backend + 22 frontend tests pass in CI, and the Sheets adapter retention rationale.
- Leave the PR open for developer review — do not merge.

**Milestone:** App runs entirely locally with no dependency on Google Sheets. All tests pass in CI. PR is open on GitHub.

---

## Phase 6 — Paid API integrations (expert reviews + pricing)

**Goal:** Layer in trusted professional review data and pricing. First paid API integrations.

**Deliverables:**
- Burghound BYOK module in `backend/modules/expert-reviews/`
- Vinous BYOK module in `backend/modules/expert-reviews/`
- Expert review layer displayed on wine entry card, attributed to source
- Trusted / distrusted reviewer list — user configurable, persistent
- Drinking window derived from expert sources
- Vintage rating: `below_avg` / `avg` / `good` / `very_good` per region + year
- Wine-Searcher price comparison module in `backend/modules/price/`
- Top retailers sorted by price with location filtering
- Shipping policy surfaced inline alongside price

**Notes:**
- Confirm Burghound and Vinous credential format (API key vs. username/password) and response schema before building — see open questions below
- Confirm Wine-Searcher API tier (500 calls/day at $250/month) before building — consider starting on the free trial tier (100 calls/day) to validate usage patterns
- Each source must speak in its own voice — do not blend or synthesise across sources

**Milestone:** Scanning a bottle returns trusted professional reviews, pricing, and vintage context alongside the wine entry.

---

## Phase 7 — Community data (Reddit + LLM synthesis)

**Goal:** Add community opinion as a third data layer. Validate the BYOK LLM synthesis pattern.

**Deliverables:**
- Reddit API module in `backend/modules/reddit/`: fetch posts from r/wine, r/burgundy, r/winetasting, r/barolo, r/wineenthusiast by wine + vintage query
- GPT-4o synthesis module: community sentiment summary + drinking window signal
- Raw Reddit excerpt fallback if no OpenAI key is configured
- Community layer displayed on wine entry card, clearly attributed

**Notes:**
- Reddit free tier supports 100 QPM via OAuth 2.0 — sufficient for per-bottle queries at personal usage scale
- Synthesis and expert review fetches are async / background — they populate the wine entry card after the initial scan result is shown
- Raw excerpts must always be available as a fallback — the community layer never disappears entirely

**Milestone:** Scanning a bottle returns community opinion alongside professional reviews and pricing.

---

## Phase 8 — Data review checkpoint

**Goal:** Before building the frontend, verify that the enriched wine object is returning useful, accurate output in practice across all three data layers.

**Deliverables:**
- Manual review of 10–20 real wine entries enriched with expert reviews, community data, and pricing
- Identify any schema gaps, data quality issues, or missing fields
- Update wine entry schema and storage adapter if required
- Document any recurring data quality issues as known limitations

**Notes:**
- This is not a build phase — it is a structured review before committing to a UI
- Any schema changes made here should be treated as migrations, not rewrites
- The goal is confidence that the data model supports the full range of UI use cases before the frontend is built

**Milestone:** Enriched wine object is validated in practice. No known schema gaps. Ready to design UI.

---

## Phase 9 — UX design and prototyping

**Goal:** Map out the full application experience before writing any frontend code.

**Deliverables:**
- Flow diagrams for each hotspot: Capture, Research, Evaluate, Cellar, Wishlist + Purchasing, Learn
- Diagrams produced in Claude.ai (this interface), not Claude Code
- Prototypes built in Magic Patterns from the diagrams
- Prototypes are reference only — not imported into the codebase

**Notes:**
- This phase happens in Claude.ai and Magic Patterns, not in Claude Code
- Claude Code receives the prototype as a visual reference and implements UI from scratch in HTML/CSS/JS or SwiftUI
- iOS is the primary surface — design mobile-first

**Milestone:** Full UX flow documented and prototyped. Ready to build frontend.

---

## Phase 10 — Frontend build

**Goal:** Build the full application UI on top of the validated data model and scan pipeline.

**Deliverables:**
- Web app in React + TypeScript: cellar management, wishlist, research, evaluate
- iOS app in Swift + SwiftUI: capture, quick log, label scan, evaluate
- Native iOS camera flow: SwiftUI camera view (AVFoundation) replaces the Phase 3 web file upload as the label scan capture surface. The backend label scan module does not change — only the input path does.
- iOS share sheet trigger: scan a bottle encountered online by sharing a photo or URL from another app
- Both frontends consuming the shared backend API
- All six hotspots implemented: Capture, Research, Evaluate, Cellar, Wishlist + Purchasing (Learn deferred to Phase 11)

**Notes:**
- Implement from Magic Patterns prototypes as visual reference — do not import prototype code
- iOS is primary surface; web parity follows
- SensorPush environment monitoring module (`backend/modules/environment/`) is included in this phase alongside the Cellar UI
- Allocation drift view (target distribution vs. actual) is included in the Cellar UI

**Milestone — GA for personal use:** App is fully functional across all core hotspots. Native iOS camera capture is live. Stable enough for daily personal use.

---

## Phase 11 — Learning features

**Goal:** Build the compounding knowledge layer. Requires sufficient data in the system to make quizzes and pattern surfaces meaningful.

**Deliverables:**
- Pattern quiz: flashcard-style, producer-to-region associations, label recognition, village tasting note characteristics, good/bad vintage years by region
- Vintage index: year-by-year quality rating per region, visible in cellar and on wine entries
- Advice archive: all captured tips searchable by category, linked to wine entries
- Live-updating wine entries: drinking windows and vintage ratings refreshed as new reviews are published

**Notes:**
- This phase requires a meaningful volume of real data in the system — do not build quizzes against an empty or sparse dataset
- The advice archive depends on conversation capture being implemented (Phase 2); verify that data exists before building the archive UI

**Milestone:** The app actively teaches rather than just stores. Pattern recognition and fluency features are live.

---

## Phase 12 — Open source release

**Goal:** Make the app generic and shareable. Abstract away hardcoded assumptions to support other users with their own API keys and preferences.

**Deliverables:**
- BYOK configuration UI for all API keys and subscription credentials (OpenAI, Reddit, Wine-Searcher, Burghound, Vinous, SensorPush)
- LLM provider made configurable — not hardcoded to OpenAI GPT-4o
- Onboarding flow for new users: configure credentials, set cellar capacity, set target allocation
- Documentation: README, setup guide, API key configuration instructions
- Repository made public on GitHub

**Notes:**
- This phase requires revisiting the credential and module interface architecture — making LLM provider configurable is a non-trivial change
- Multi-user authentication remains out of scope — this is still a single-user app, shared as open source for others to self-host
- All hardcoded assumptions (reviewer lists, default allocation targets) must be made configurable before release

**Milestone — Open source release:** App is self-hostable by others. Repository is public. Setup documentation is complete.

---

## Open questions affecting phases

- [ ] Free wine data API: no suitable free API identified for Phase 2 enrichment; GPT-4o label scanning (Phase 3) is the primary enrichment path. Revisit if a reliable free option emerges.
- [ ] Wine-Searcher API tier: confirm before building Phase 6
- [ ] Burghound and Vinous credential format: confirm before building Phase 6
- [ ] GPT-4o Mini evaluation: test against GPT-4o for label scanning after Phase 3 is stable — potential 75% cost reduction for clean labels
