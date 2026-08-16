# Build Phases
> Wine app project | Placeholder name: [APP_NAME] | Last updated: 2026-08-02
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

**Goal:** Validate the full label scan pipeline — image intake, GPT-4o vision extraction, Tier 1/2 field population, and entry card review — without requiring a native iOS app. The intended production capture surface is the iOS camera (Phase 11); this phase proves the backend pipeline using a web file upload as a pragmatic stand-in.

**Deliverables:**
- GPT-4o vision label scan module in `backend/modules/label-scan/`
- Image resize pipeline: max 1024px on longest side before API call — applied regardless of input source
- Scan returns structured JSON covering all Tier 1 fields (producer, vintage, region, denomination) and Tier 2 fields (quality_classification, vineyard, cuvee, grape_varieties) where extractable. `name` has been removed — do not include it in scan output.
- Tier 2 extraction follows the rules defined in `wine-app-product-context.md` Section 3 — the label scan prompt must explicitly encode these rules, not infer them
- Web UI file upload: user selects or drops a photo of a wine label → scan runs → pre-populated entry card displayed for review → user confirms or adjusts → saves to Sheets
- End-to-end latency target: under 30 seconds from upload to populated entry card

**Notes:**
- The capture surface in this phase is a web file upload (HTML file input accepting image/*), not a native camera. This is intentional — the goal is to validate the scan pipeline, not the capture UX.
- The native iOS camera flow (SwiftUI, AVFoundation) is built in Phase 11. The backend label scan module does not change at that point — only the capture surface is swapped.
- Raw image input must always be resized to max 1024px before the API call — enforce this in the module regardless of how the image arrives (file upload now, camera later)
- Tier 1 fields that the scan cannot populate must surface a manual entry prompt in the UI — never silently omit
- Tier 2 fields that the scan cannot populate are left null — do not prompt the user unless they choose to edit
- If the OpenAI key is not configured, label scan is unavailable with a clear UI message; manual entry remains available

**Milestone:** A wine label photo uploaded via the web UI produces a populated entry card — with Tier 2 fields extracted where present — in under 30 seconds. The scan pipeline is validated and ready. iOS camera integration is deferred to Phase 11.

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
- HTML is sufficient for this phase — visual design and interaction polish deferred to Phase 11
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
- HTML UI is sufficient — polish deferred to Phase 11
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
| `drinking_window_start` | TEXT | ISO date string — nullable. Derived from professional review extraction (Phase 8) when unambiguous — never blended across disagreeing critics, see Phase 8. User-editable at any time, at manual wine-entry creation or later; a manually-set value is never overwritten by a later automated run. |
| `drinking_window_end` | TEXT | ISO date string — nullable. Same rules as `drinking_window_start`. |
| `vintage_rating` | TEXT | `below_avg`, `avg`, `good`, `very_good` — nullable. Displayed as **"Year"** in the UI (developer preference — not a field rename). Sourced from professional review vintage-character extraction (Phase 8) — never blended across critics; populated only when sources agree, otherwise left null. |
| `my_rating` | TEXT | `poor`, `acceptable`, `good`, `very_good`, `outstanding` — nullable |
| `my_tags` | TEXT | JSON array string — kept in sync with tasting note tags |
| `latest_tasting_note_id` | TEXT | UUID FK → `tasting_notes.id` — nullable |
| `wishlist_notes` | TEXT | Nullable |
| `price_paid` | REAL | Nullable |
| `purchased_from` | TEXT | Nullable |
| `date_added` | TEXT NOT NULL | ISO timestamp — set on insert |
| `date_first_consumed` | TEXT | ISO timestamp — set once on first note save, never overwritten |
| `advice_linked` | TEXT | JSON array of `advice.id` UUIDs — nullable; kept in sync by `createAdvice` when linked to a wine |
| `expert_reviews` | TEXT | JSON — nullable; reserved column, not populated by any shipped phase. Early design intent, superseded by `price_data` (Phase 6) and `review_data` (Phase 7) for scores/reviews. Leave in place; do not populate or remove without a separate decision. Cleanup debt noted 2026-07-26: `backend/modules/expert-reviews/` is a leftover empty directory (predates this session's work, not referenced by any current phase or code) — safe to delete, or leave as a placeholder; not blocking anything. Same applies to `backend/modules/reddit/` (also empty, noted 2026-07-28) — a leftover from the original Reddit-based Phase 8 plan, retired before any code was written into it; safe to delete or leave in place, not blocking Phase 8. |
| `community_sentiment` | TEXT | Nullable — reserved for the community-sentiment PoC (Phase 8.5, exploratory, not committed). Phase 8 itself no longer targets these columns — see Phase 8's context note for why the original Reddit-based plan was retired. |
| `community_excerpts` | TEXT | JSON array — nullable; same reservation as `community_sentiment`, see Phase 8.5. |
| `price_data` | TEXT | JSON object — nullable. **The actual storage for all Phase 6 pricing/retailer output** (see Phase 6): `{ price_min, price_avg, price_max, retailers: RetailerResult[], nearest_retailer, fetched_at }`. One blob, not separate flat columns — `price_min`/`price_avg`/`price_max`/`nearest_retailer` are keys inside this JSON, never top-level SQL columns. |
| `retailer_links` | TEXT | JSON object — nullable; keyed by retailer slug (Phase 6.6). User-saved URLs only. |

> **Note (corrected 2026-07-22, refined 2026-07-26):** five of the six rows above — `advice_linked`, `expert_reviews`, `community_sentiment`, `community_excerpts`, `price_data` — already exist in `backend/db/schema.sql`'s base `CREATE TABLE` as of the current codebase but were missing from this table; a documentation gap, not a schema gap. `retailer_links` is the exception: it isn't in `schema.sql` at all — it's added via `ALTER TABLE` in `backend/db/migrations/001_phase6_wine_searcher.sql`, applied at startup by the migration runner alongside that migration's other (vestigial) columns. Functionally identical either way — the column exists in the live DB regardless of which file defines it — but the two are worth distinguishing since one is a base schema field and the other is a migration-added one. That same migration also added flat `ws_price_min` / `ws_price_avg` / `ws_price_max` / `ws_score` / `ws_price_fetched_at` / `ws_retailers` columns from an earlier Wine-Searcher-API-based design that was later abandoned in favor of Serper. **`sqlite-adapter.ts` never reads or writes those `ws_*` columns** — they are vestigial and not part of the live data flow. Build against `price_data` and `retailer_links` only. Removing the `ws_*` columns via a follow-up migration is optional cleanup, not a blocker for Phase 6.6 or Phase 7.

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

## Phase 6 — Price enrichment (Serper + Puppeteer)

**Goal:** Enrich the wine entry with current retail pricing, retailer availability, and attributed critic scores. Phase 6 is not complete until a real wine entry in the database shows populated price, retailer, and score fields from a live run. A manual test against a real bottle is required to close the phase.

**Context and architecture decision:** The original approach — fetching retailer product pages directly via HTTP — was invalidated when Claude Code discovered that Zachys, Woodland Hills, and Benchmark are all SPAs. Server-side fetches return ~768 bytes of empty shell HTML. Two tools replace it:

1. **Serper.dev** — a third-party Google SERP API that queries Google on your behalf and returns structured JSON including Shopping results. Google has already crawled and rendered the SPA pages; Serper returns their indexed data cleanly without any browser required. Free tier: 2,500 queries/month — well above personal usage. Single API key, no domain restrictions, no expiry risk. Note: Google's own Custom Search JSON API is closed to new customers as of 2025 and deprecated January 2027; Serper is the practical replacement.
2. **Puppeteer** — a headless Chromium browser that executes JavaScript so SPA pages render fully before extraction. Used only for Step 2 (score extraction from specific product pages) — not for the Serper query.

**Two-step workflow:**

**Step 1 — Serper query (price + retailer discovery)**
- On scan or manual refresh trigger, the price module sends a query to the Serper API for the wine (`producer + denomination + vintage`)
- Response includes Shopping results and organic results from across the web
- Results are filtered for configured retailer domains — the retailer list is extensible via config, not hardcoded in logic
- Pass 1: filter results for configured preferred retailers (K&L, Zachys, Woodland Hills, Benchmark at launch — expanded to eight retailers in Phase 6.7)
- **Corrected in Phase 7.1 (2026-07-26):** the retailer's own on-site search URL (rendered by `verify-listing.ts` to confirm a price is still live) was being built from the same vintage-qualified query as the Serper Shopping call, causing false negatives on retailers whose own search is a literal token match rather than relevance-ranked. See Phase 7.1 for the fix — the retailer-search URL now uses a vintage-free query; the Serper Shopping query itself is unchanged.
- Pass 2 (fallback): if Pass 1 returns no matches, use the unfiltered Serper results — any wine retailer Google found. Flag these as "other retailers" in the stored data.
- From matching results, extract per retailer: name, price, product URL
- Compute `price_min`, `price_avg`, `price_max` across all matching results
- Identify nearest retailer to NYC using Haversine distance from static retailer coordinate lookup
- Store all results as a point-in-time snapshot in the `price_data` JSON column (see Phase 5 schema) — `price_min`, `price_avg`, `price_max`, `retailers`, `nearest_retailer`, and `fetched_at` are keys inside that one blob, not separate SQL columns

**Step 2 — Puppeteer score extraction (attributed critic scores)**
- For each product URL returned in Step 1, Puppeteer opens the URL in headless Chromium
- Waits for the page to fully render (product data visible in DOM)
- Passes rendered HTML to GPT-4o with a structured extraction prompt
- GPT-4o extracts: any critic scores visibly attributed to a named publication (score value + publication name). Never infer or hallucinate attributions. Never extract tasting note text.
- Results stored per retailer inside the `retailers` array within the `price_data` JSON blob, alongside price and URL
- Runs async — does not block Step 1 results from displaying
- Each retailer page is independent — if one fails, the others continue

> **Superseded 2026-07-19 / 2026-07-20:** Step 2 as described above stopped being viable once every retailer URL the price module produces was confirmed to be a search-results page rather than a real product page (see the Phase 9 "Known gap" note). The GPT-4o call was removed from the pricing path entirely. Attributed critic-score extraction now happens in **Phase 7**, against a real product page located via a different mechanism. The `retailers` array inside `price_data` no longer carries a `critic_scores` field — see Phase 7.

**Retailer configuration (`backend/modules/price/retailers.config.ts`):**

Config-driven — adding a retailer requires only a new entry here, no logic changes:

```typescript
export const RETAILER_CONFIG = [
  { slug: 'kl',        name: 'K&L Wine Merchants',      domain: 'klwines.com',           lat: 40.7580, lng: -73.9855 },
  { slug: 'zachys',    name: 'Zachys',                  domain: 'zachys.com',            lat: 41.0026, lng: -73.6693 },
  { slug: 'woodland',  name: 'Woodland Hills Wine Co.', domain: 'woodlandhillswine.com', lat: 34.1684, lng: -118.6059 },
  { slug: 'benchmark', name: 'Benchmark Wine Group',    domain: 'benchmarkwine.com',     lat: 38.2975, lng: -122.2869 },
]
```

> **Moved to `shared/config/retailers.config.ts` in Phase 7** — both the price and reviews modules need this same retailer metadata, and modules can't import from each other. See Phase 7 for the relocation.

**Serper API setup:**
- Sign up at `serper.dev` — free tier gives 2,500 queries/month, no credit card required
- API key stored in `.env` as `SERPER_API_KEY`
- Add to `.env.example`
- Serper Shopping endpoint: `POST https://google.serper.dev/shopping` with `{ q: "producer denomination vintage wine", gl: "us" }`

**GPT-4o extraction prompt requirements:**
- Input: fully rendered HTML from Puppeteer
- Output: `{ critic_scores: [{ publication: string, score: number }] }`
- Extract only scores visibly attributed to a named publication — never infer or hallucinate
- If no attributed scores found, return empty array
- Prompt documented in `backend/modules/price/PROMPT.md`

> **Moved to `backend/modules/reviews/PROMPT.md` in Phase 7** alongside `gpt-extract.ts` — this prompt was dead code in the price module after Step 2 was removed (above), and is exactly what Phase 7 needs unchanged.

**Puppeteer configuration:**
- Installed via npm: `puppeteer`
- Runs locally — headless Chromium downloaded automatically on first install
- Per-page timeout: 15 seconds — skip retailer gracefully if exceeded
- Standard browser user agent to avoid bot detection
- Do not run Puppeteer in CI — mock using pre-captured HTML fixtures in tests

**Module structure (`backend/modules/price/`):**
```
price/
├── index.ts               # Orchestrates Step 1 and Step 2
├── serper-query.ts        # Serper API call + retailer filtering
├── puppeteer-extract.ts   # Headless browser render + HTML capture
├── verify-listing.ts      # Renders each retailer's search-results page and confirms it still shows a result before trusting Serper's price (added 2026-07-19, replaces the old Step 2 GPT-4o call above) — known fidelity gap found 2026-07-26, see note below
├── retailers.config.ts    # Extensible retailer list with coordinates — moved to shared/ in Phase 7
├── PROMPT.md              # Moved to backend/modules/reviews/ in Phase 7
├── types.ts               # TypeScript types
└── price.test.ts          # Unit tests (mocked Serper responses + HTML fixtures)
```

> **Known fidelity gap, found 2026-07-26 (not yet fixed):** headless Puppeteer can capture a retailer search page before its client-side search has actually finished resolving. Rendering a Zachys search URL with `waitUntil: 'domcontentloaded'` showed 140+ results for a query that, in a real browser after the page fully settles, actually shows 0 — the initial HTML shell carries a stale/placeholder result count that gets replaced once the client-side search resolves. This is a real risk for any headless-Puppeteer "does this page show results" check, `verify-listing.ts`'s `pageShowsNoResults` specifically included: a `domcontentloaded` render can report "results found" when the settled page would show none, the opposite failure direction from the false negatives this module was built to catch. It didn't block Phase 7.2 (which renders a specific known product page, not a search-results page, so this timing issue doesn't apply there), but `verify-listing.ts`'s existing logic hasn't been re-audited against it. Worth its own investigation — e.g. switching to `waitUntil: 'networkidle0'` or waiting for a specific results-count element to stabilize — rather than folding into an unrelated phase.

**Graceful degradation:**
- `SERPER_API_KEY` not configured → return null for all price fields, no error
- Serper returns no matches for preferred retailers → fall back to any retailer results
- Serper returns no results at all → null, no error
- Puppeteer timeout → `critic_scores: []` for that retailer, price/URL from Step 1 retained
- GPT-4o finds no attributed scores → `critic_scores: []`, not an error

**Tests:**
- Unit: Serper response correctly filtered by preferred retailer domains
- Unit: fallback to non-preferred retailers when preferred returns nothing
- Unit: `price_min`/`price_avg`/`price_max` aggregation from known inputs
- Unit: nearest retailer selection using Haversine utility
- Unit: GPT-4o extraction returns correct structure from fixture HTML
- Unit: graceful degradation — no API key returns null without throwing
- Integration: end-to-end with mocked Serper response and mocked Puppeteer fixtures — verify wine entry DB fields are correctly populated

**Phase 6 completion criteria — manual test required:**
1. A real wine bottle is scanned via the web UI
2. The price module runs automatically post-scan
3. Inspect the wine entry: `sqlite3 backend/db/wine.db "SELECT price_data FROM wines ORDER BY date_added DESC LIMIT 1;"` — `price_data` is a single JSON blob (see Phase 5 schema); parse it and confirm `price_min`, `price_avg`, `price_max`, `nearest_retailer`, and `retailers` are all populated. There are no separate flat columns for these.
4. Entry shows non-null values for all price fields within the parsed `price_data` object

~~5. At least one retailer in `price_data.retailers` has a non-empty `critic_scores` array~~ — **dropped 2026-07-19.** Attributed critic-score extraction requires rendering an actual single-product page; every retailer URL this module produces (preferred and fallback alike) is a constructed search-results page, and always will be, since Serper never returns a trustworthy product URL to build one from. Score sourcing is real work — locating the correct product link within a rendered search page, then rendering that page too — and is scoped as its own phase, not folded into pricing. See the Phase 9 "Known gap" note and Phase 7 below for the decision record.

Document the test result in the session summary (which wine, which retailers responded).

**Branch:** `service/price-enrichment`
**PR title:** `service: price enrichment — Serper + Puppeteer`

**Milestone:** A real wine entry in the database has price, retailer, and attributed critic score fields populated via the two-step workflow. The retailer list is config-driven and extensible.

---

## Phase 6.4 — Repo hygiene checkpoint (commit + open pending PRs)

**Goal:** Before continuing into Phase 6.5, bring the local working tree and remote branches back in sync. Several sessions of Phase 6 work (Google CSE → Puppeteer rewrite → Serper.dev replacement) left uncommitted local changes and at least one PR that was never opened. Close that gap first.

**Context:** As of the last session, `feature/detail-and-scan-ui` has unstaged/untracked changes in the local environment (`.claude/settings.local.json` modified; `.claude/launch.json`, `backend/db/wine.db-shm`, `backend/db/wine.db-wal` untracked). The "Detail Modal + Enhanced Scan UI" session (`docs/sessions/2026-05-30-detail-and-scan-ui.md`) explicitly deferred opening a PR ("_To be opened after this commit._") — it was never opened. Phase 6.5 and 6.6 work has since been built on top of this same branch without a PR ever existing for review.

**Deliverables:**

1. **Gitignore audit** — `backend/db/wine.db-shm` and `backend/db/wine.db-wal` are SQLite WAL/shared-memory artifacts and must never be committed. Confirm `backend/db/wine.db*` (or equivalent pattern) is in `.gitignore`; add it if missing. If either file is already tracked, untrack it (`git rm --cached`) without deleting it locally.
2. **Local dev config review** — `.claude/settings.local.json` and `.claude/launch.json` are local tooling config. Confirm whether these are meant to be shared (commit) or developer-local (gitignore). Default to gitignoring unless the developer confirms otherwise.
3. **Stage and commit outstanding source changes** — any remaining legitimate changes on `feature/detail-and-scan-ui` (i.e. not covered by points 1–2) are committed with conventional commit messages matching the existing history style (`service:`, `feat:`, `docs:`, `chore:`, `test:`).
4. **Push and open the deferred PR** — push `feature/detail-and-scan-ui` to `origin` and open the PR that was never created. Title: `feat: detail modal, enhanced scan UI, phase 6 price enrichment (Serper + Puppeteer), phase 6.5/6.6`. Description should cover: the Google CSE → Puppeteer → Serper pivot, the detail modal, the redesigned scan flow, and note that Phase 6's manual completion test is still outstanding.
5. **Reconcile older open PRs** — check the status of PR #2 (`service/sqlite-migration`) and PR #3 (`feature/phase6-wine-searcher`) on GitHub. Both branches are superseded by later work already merged into or built on top of `feature/detail-and-scan-ui`. Confirm whether they're already merged; if not, merge or close them explicitly with a comment pointing to the branch that superseded them, rather than leaving them stale.

**Notes:**
- This is a housekeeping phase, not a feature phase — no new application code should be written here.
- Do not squash or rewrite existing commit history; this phase only adds new commits and opens/reconciles PRs.
- Phase 6 (price enrichment) itself remains open pending its manual completion test — this phase does not close Phase 6, it just cleans up the repo state around it.

**Milestone:** Working tree is clean (`git status` shows no unexpected unstaged/untracked files), the deferred PR for `feature/detail-and-scan-ui` is open on GitHub, and PRs #2 and #3 are either merged or explicitly closed with a superseding-branch note.

---

## Phase 6.5 — Scan review UI + wine detail view

**Goal:** Surface crawled pricing and retailer data meaningfully in two distinct UI contexts: the post-scan review screen and a new read-only wine detail view accessible from any list.

---

### Deliverable 1 — Post-scan review screen: two-tab layout

The existing post-scan screen (where the user reviews and confirms a scanned wine entry before saving) gains a two-tab structure.

**Tab 1 — Wine info**

Displays all fields extracted from the label scan as before. No changes — GPT-4o label scan is the sole source for wine identity fields. If the scan cannot populate a Tier 1 field, surface a manual entry prompt. Do not attempt to fill missing fields from any external source.

**Tab 2 — Price & availability**

Read-only. Populated async — shown as a loading state until results arrive; gracefully empty if nothing found.

Results arrive in two waves:
- **Wave 1 (Serper query, faster):** Average price, retailer list with prices and links, nearest retailer to NYC. Preferred retailers flagged if present; fallback retailers labelled "other retailers".
- **Wave 2 (Puppeteer + GPT-4o, slower):** Attributed critic scores per retailer added as they complete.

> **Note (Phase 7):** Wave 2 as described here never actually populated (see Phase 6's superseded Step 2 note above). Critic scores now arrive from the `reviews` module's own async run, sourced from `review_data`, not from the price module's wave 2. `WineDetailModal`'s critic scores row was repointed accordingly in Phase 7 — see below. This post-scan screen's Tab 2 should get the same treatment when it's next touched, but it is not in scope for Phase 7's deliverables.

Contents when populated:
- **Critic scores** — attributed scores extracted from rendered retailer pages (e.g. "Burghound: 92"). Each displayed with publication name. Omit if none found.
- **Average price** — `price_data.price_avg` formatted as currency. Omit if null.
- **Nearest retailer** — single row: name, price, tappable link. Sourced from `price_data.nearest_retailer`. Nearest to NYC using Haversine distance from retailer config. Omit if no results.

---

### Deliverable 2 — Wine detail view

A new read-only screen accessible by tapping any wine entry from any list view. Replaces any existing tap behaviour on list rows. Compact label/value layout — not a form.

**Fields displayed, in order:**

| Field | Source | Display rule |
|---|---|---|
| Producer | `producer` | Always shown |
| Denomination | `denomination` | Always shown |
| Vintage | `vintage` | Always shown; display "NV" if null |
| Region | `region` | Always shown |
| Quality classification | `quality_classification` | Omit row if null |
| Vineyard / lieu-dit | `vineyard` | Omit row if null |
| Cuvée | `cuvee` | Omit row if null |
| Grape varieties | `grape_varieties` | Omit row if null |
| Status tags | `tag_discovered`, `tag_wishlist`, `tag_cellar`, `tag_consumed` | Display as badges for whichever tags are currently true. All on one row. Read-only. |
| Review link(s) | `retailer_links` | If one or more retailer URLs have been saved (from Phase 6.6 workflow), display each as a tappable link labelled with the retailer name (e.g. "K&L review"). Omit row entirely if none saved. |
| Avg price | `price_data.price_avg` | Labelled "Avg price (crawled retailers)". Omit if null. |
| Critic scores | `review_data` (Phase 7 — was `price_data.retailers[].critic_scores` prior to Phase 7; see note above) | Any attributed scores extracted from retailer product pages (e.g. "Burghound: 92"). Each score shown with publication name. Omit row if none found. |
| Nearest retailer | `price_data.nearest_retailer` | Single closest retailer to NYC — name, price, tappable link. Omit if null. |

**Layout and behaviour rules:**
- Null Tier 2 fields are hidden entirely — no empty rows, no placeholder dashes. The view collapses around what exists.
- Status badges sit together on one row.
- All links open in the default browser — no in-app webview.
- No edit controls, no Evaluate CTA. This is a reference view only.
- Visually more compact than the Add Wine form — tight label/value pairs, not input chrome.
- Back navigation returns to the originating list.

---

**Shared utility:**
- Haversine distance calculation (nearest retailer to NYC) is implemented as a pure function in `shared/utils/proximity.ts`. Retailer coordinates come from `backend/modules/price/retailers.config.ts` defined in Phase 6 (relocated to `shared/config/retailers.config.ts` in Phase 7).

**Schema additions (on top of Phase 6):**
- No new columns required — all fields used in this phase (`price_data.price_avg`, `price_data.retailers`, `price_data.nearest_retailer`, `retailer_links`) already exist per the Phase 5 schema table. `price_avg`, `retailers`, and `nearest_retailer` are keys inside the single `price_data` JSON column, not separate SQL columns. The critic scores row's source column changes to `review_data` in Phase 7 (new column) — see Phase 7 deliverable 6.

**Milestone:** Post-scan screen shows wine info and crawled pricing in separate tabs. Tapping any wine entry from any list opens the compact detail view showing attributed critic scores, avg price, and nearest retailer.

---

## Phase 6.6 — Retailer review links

**Goal:** Surface pre-constructed deep-link searches to trusted fine wine retailers directly from the wine entry card. Enables fast access to professional reviews and tasting notes published on retailer product pages without any scraping or API dependency.

**Context:** Research confirmed that no professional wine publication (Burghound, Vinous, Wine Advocate) offers API access to individual subscribers. The only programmatic access routes require enterprise-level trade memberships costing thousands per year. The retailer deep-link approach achieves the same practical outcome — fast access to trusted reviews — without any ToS exposure. The app constructs the search URL from structured wine entry data; the user taps to open it in their browser.

**Deliverables:**
- Link generator module in `backend/modules/retailer-links/`
- Takes `producer`, `denomination`, `vintage` from the wine entry and constructs retailer-specific search URLs for each configured retailer
- Four retailers configured in v1 (expanded to eight in Phase 6.7 — see below):
  - **K&L Wine Merchants** (`klwines.com`) — highest review density; carries Burghound, Vinous, Wine Spectator, Wine Advocate on product pages
  - **Zachys** (`zachys.com`) — fine wine specialist, NYC-area, strong Burgundy/Bordeaux depth
  - **Woodland Hills Wine Company** (`woodlandhillswine.com`) — trusted retailer with solid review coverage
  - **Benchmark Wine Group** (`benchmarkwine.com`) — fine wine specialist, publishes Burghound, Vinous, Wine Advocate, Wine Spectator, James Suckling
- Wine entry card displays a "Find Reviews" section with one tappable button per retailer (e.g. "Search K&L", "Search Zachys")
- Each button opens the pre-constructed search URL in the user's default browser — no in-app webview
- User can optionally save a URL (either the search query URL or a specific product page URL) back to the wine entry — stored in `retailer_links` keyed by retailer slug
- Saved URLs are displayed as tappable links in the wine detail view (Phase 6.5) in subsequent sessions

**Schema additions:**
- `retailer_links` TEXT — JSON object; keyed by retailer slug (e.g. `{ "kl": "https://...", "zachys": "https://..." }`); nullable; stores user-saved URLs only, not generated search URLs

**Notes:**
- The app never visits retailer sites — it only constructs URL strings and hands them to the OS. No ToS implications.
- Generated search URLs are constructed fresh from wine entry data on each render — they are not stored. Only user-saved URLs are persisted.
- URL construction uses each retailer's native search endpoint where reliable (e.g. `klwines.com/search?query=...`). Verify search URL patterns against each retailer's live site before building — these can change.
- The Burgundy Report (`burgundy-report.com`) is a candidate for a future addition. Its ToS explicitly permits reproduction of tasting notes for currently available wines with attribution, for active subscribers. Deferred — do not build in this phase.

**Milestone:** Wine entry card shows one-tap search buttons for all four retailers, pre-populated with wine identity data. User-saved retailer URLs persist across sessions and appear in the wine detail view.

---

## Phase 6.7 — Retailer list expansion (tri-state)

> **Status check (2026-07-26): scoped here, not yet built in code.** `RETAILER_CONFIG` in both `shared/config/retailers.config.ts` and `backend/modules/retailer-links/retailers.config.ts` still lists exactly the original four retailers (K&L, Zachys, Woodland Hills, Benchmark) — Sokolin, Acker Wines, Wine Library, and Morrell & Company have not been added to either copy. Later doc passages (e.g. the open-questions list) that refer to "the other configured retailers" or an eight-retailer set are describing this phase's intended end state, not the current live config. Don't build further on the assumption that the eight-retailer set already exists until this phase's deliverables actually ship.
>
> **Resolved 2026-07-29:** shipped as part of Phase 7.3, alongside three more developer-nominated retailers (Crush, Flatiron, Thatcher's) and an architectural fix to `backend/modules/retailer-links/retailers.config.ts`, which turned out to be a second, never-migrated duplicate of this same data — see Phase 7.3. `RETAILER_CONFIG` now lists eleven retailers, not eight.

**Goal:** Expand the four-retailer config beyond the original K&L / Zachys / Woodland Hills / Benchmark set to increase coverage of the critic publications the developer actually trusts, with a preference for retailers based in the NYC tri-state area — matching the app's NYC-centric proximity and shipping-risk logic from `wine-app-product-context.md` (heat/transit damage is a named purchasing pain point).

**Context (decided 2026-07-20):** The original four were selected purely for Burghound/Vinous review density, with no geographic constraint — K&L and Benchmark are California-based, Woodland Hills/whwc is Los Angeles. The developer's trusted publication list is broader than originally scoped: Burghound, Vinous, Wine Advocate, Decanter, and Wine Enthusiast. Four tri-state candidates were sourced and vetted against both criteria:

- **Source list:** Cross-referenced against Burghound.com's own published "Wine Retailers" page — a list of Burghound subscriber-retailers Burghound itself vouches for (they explicitly take no paid advertising for this list) — filtered to Connecticut / New Jersey / New York entries.
- **Vetting:** For each tri-state candidate, confirmed via search that its product pages actually display attributed scores from the target publications (not just that the retailer subscribes to Burghound), and checked `robots.txt` on the live site to confirm no blanket automated-access block — same diligence as the K&L `robots.txt` check in Phase 7.

**New retailers added to `RETAILER_CONFIG`, bringing the total to eight:**

| Slug | Name | Domain | Location | Confirmed publications on product pages |
|---|---|---|---|---|
| `sokolin` | Sokolin | `sokolin.com` | Bridgehampton, NY (Hamptons) | Burghound, Vinous, Wine Advocate, Decanter, Wine Enthusiast — all five. Has a dedicated `/wine-ratings` page. |
| `acker` | Acker Wines | `ackerwines.com` | Manhattan, NY (160 W 72nd St) | Wine Advocate, Vinous confirmed |
| `winelibrary` | Wine Library | `winelibrary.com` | Springfield, NJ | Wine Advocate, Vinous, Decanter confirmed |
| `morrell` | Morrell & Company | `morrellwine.com` | Briarcliff Manor, NY (Westchester — relocated from Rockefeller Center) | Wine Advocate confirmed |

```typescript
export const RETAILER_CONFIG = [
  { slug: 'kl',          name: 'K&L Wine Merchants',      domain: 'klwines.com',           lat: 40.7580, lng: -73.9855 },
  { slug: 'zachys',      name: 'Zachys',                  domain: 'zachys.com',            lat: 41.0026, lng: -73.6693 },
  { slug: 'woodland',    name: 'Woodland Hills Wine Co.', domain: 'woodlandhillswine.com', lat: 34.1684, lng: -118.6059 },
  { slug: 'benchmark',   name: 'Benchmark Wine Group',    domain: 'benchmarkwine.com',     lat: 38.2975, lng: -122.2869 },
  { slug: 'sokolin',     name: 'Sokolin',                 domain: 'sokolin.com',           lat: 40.9376, lng: -72.3009 },
  { slug: 'acker',       name: 'Acker Wines',             domain: 'ackerwines.com',        lat: 40.7796, lng: -73.9800 },
  { slug: 'winelibrary', name: 'Wine Library',            domain: 'winelibrary.com',       lat: 40.6976, lng: -74.3421 },
  { slug: 'morrell',     name: 'Morrell & Company',       domain: 'morrellwine.com',       lat: 41.1445, lng: -73.8557 },
]
```

**Notes:**
- `RETAILER_CONFIG` is defined in `backend/modules/price/retailers.config.ts` per Phase 6, relocating to `shared/config/retailers.config.ts` per Phase 7 — this expansion applies wherever the config lives at implementation time.
- Coordinates are approximate (town/street-level), consistent with the precision used for the original four — sufficient for Haversine nearest-retailer ranking, not for driving directions.
- Morrell & Company's address moved out of Manhattan proper to Briarcliff Manor, NY after the Rockefeller Center location closed — still tri-state, just no longer the closest-to-Manhattan option its old address would have suggested.
- Score-display confirmation above is from search-indexed snippets, not a live Puppeteer render — the same "verify empirically" caveat that applied to the original four's Serper/robots.txt findings applies here too. Re-confirm during Phase 6 / Phase 7 implementation, not just at doc-writing time.
- This expansion touches three places downstream: `RETAILER_CONFIG` itself (Pass 1 "preferred retailers" in the price module, Phase 6), the "Four retailers configured in v1" list in Phase 6.6 (retailer deep-links — now eight), and Phase 7's product-page discovery (Step 1 runs the same `site:<domain>` Serper query per retailer, so it scales to eight with no logic change).
- `CLAUDE.md`'s retailer-links module description is updated to reflect eight retailers, for consistency with this file.

**Milestone:** `RETAILER_CONFIG` lists eight retailers. Price module Pass 1, retailer deep-links (Phase 6.6), and review sourcing (Phase 7) all operate over the same eight-retailer set with no per-retailer special-casing beyond what already exists for K&L (the `www.klwines.com` vs. `shop.klwines.com` robots.txt / bot-detection distinction).

---

## Phase 7 — Review & critic score sourcing

**Goal:** Extract attributed critic scores (e.g. "Burghound: 92") from an actual retailer product page — the capability originally described as part of Phase 6's Step 2, split out as its own phase and reordered ahead of community data (decided 2026-07-19): scores/reviews are core research functionality for a purchasing decision, and it made more sense to build that out before the more exploratory community-sentiment layer. Phase 7 is not complete until a real wine entry already in the database shows at least one attributed critic score sourced from a live, rendered retailer product page — the counterpart to Phase 6's completion test, for scores instead of price.

**Why this is a separate module from pricing:** Pricing only needs a page that reliably loads and shows the right listing — a search-results page is fine for that, and every retailer URL the price module produces (preferred and fallback) is deliberately a search-results page, verified live before its price is trusted (`verify-listing.ts`). Review sourcing needs something a search-results page structurally cannot provide: the specific single-product page, because that's where an attributed score actually lives in the DOM. Serper's Shopping endpoint never returns a trustworthy product URL to start from (its `link` field is always a `google.com/search?ibp=oshop` aggregator link — confirmed empirically, see Phase 9), so combining the two concerns into one module was never actually working. See the Phase 9 "Known gap" note for the full decision record.

**Architecture decision — product page discovery via Serper organic search, not on-site search rendering (decided 2026-07-20):** The original plan for Step 1 was to render each retailer's own on-site search-results page with Puppeteer and parse listing links for the correct product — mirroring how the price module verifies listings via `verify-listing.ts`. This was dropped after two findings during scoping:

1. `shop.klwines.com` — K&L's actual e-commerce host, as distinct from the `www.klwines.com` marketing domain — has a permissive `robots.txt` (`Allow: /`, only `/resetpassword` disallowed). Puppeteer *is* blocked from rendering K&L's on-site search page in practice, but that block is bot-detection fingerprinting (Cloudflare/PerimeterX-style), not stated policy — unlike CellarTracker or WineBerserkers, where the ToS explicitly prohibits automated access and the project deliberately stayed away from both. This is a technical obstacle, not an ethical boundary, so it's fair to route around rather than treat K&L as off-limits.
2. A manual test of Google's organic search (a `site:shop.klwines.com` restricted query for a real wine — Domaine Leflaive Puligny-Montrachet 1er Cru "Les Pucelles" 2019) returned direct product URLs (`shop.klwines.com/products/details/1557135`), not the `google.com/search?ibp=oshop` aggregator-link problem that affects the Shopping vertical. Organic results link straight to the source page; only Shopping wraps links in a comparison redirect.

Given both findings, Step 1 uses Serper's organic `/search` endpoint (not `/shopping`) with a `site:`-restricted query, applied to all four retailers — not a K&L-specific patch. This removes a full Puppeteer render pass from Step 1 entirely (it becomes a single Serper API call), and it doesn't depend on any individual retailer's on-site search behaving predictably or being crawlable at all.

**Architecture decision — extraction windowing, not blind truncation (decided 2026-07-24):** Phase 7 was fully built, code-reviewed, and passing 10 mocked unit tests, then live-tested end-to-end against 21 real wines from the actual collection (3 already in the database plus 18 more, for broader coverage) using real Serper/Puppeteer/OpenAI calls. Result: 0 of 21 wines produced any attributed critic score, even though roughly half found genuinely correct product pages on at least one retailer (verified by eyeballing matched URLs — e.g. an exact "Clos des Papes Châteauneuf-du-Pape 2020" match on all three responsive retailers).

Root cause, diagnosed by rendering three confirmed-correct product pages directly and inspecting the raw HTML independent of GPT-4o's interpretation:
- `gpt-extract.ts` truncates rendered HTML to the first 80,000 characters before sending it to GPT-4o (`html.slice(0, 80_000)`) — code inherited unchanged from the pricing module, where it never mattered because pricing only ever rendered search-results pages, not long single-product pages.
- On real product pages this cutoff lands well before the actual review content. Zachys's page rendered at 879,212 characters, with the "Professional Reviews" section starting at offset 384,907 — nearly 5x past the cutoff. Benchmark's page rendered at 189,524 characters, review section at offset 116,366 — also past it. The scores are genuinely on the page; truncation just throws them away before the model ever sees them.
- K&L's page (`shop.klwines.com`) rendered as only ~2,600 characters — a bot-detection stub, not real content. This is a new finding, not the same issue as the truncation bug: K&L blocks Puppeteer on **product** pages too, not just the on-site search page already known to be blocked (see the architecture decision above). The whole Phase 7 design was betting this wouldn't be blocked, and it is.

**K&L decision (2026-07-24): accept as a known gap, do not pursue stealth-Puppeteer or other bot-detection-evasion techniques.** This is a different category of action than the earlier Serper-organic-search decision. Routing product-page *discovery* through Serper instead of K&L's own on-site search was justified as avoiding a technical obstacle without crossing an ethical line (K&L's `robots.txt` is permissive; only their live bot detection blocks direct access, and the project never touches K&L's own search endpoint as a result). Actively masking a headless browser's fingerprint to defeat that same detection system on the product-render step is a step further — it moves from "finding an alternate path" to "circumventing a security control," which is a materially different judgment call the project isn't making here. K&L is expected to contribute zero critic scores going forward; this does not block Phase 7 completion, which only requires at least one retailer to succeed (see completion criteria below), and the other seven configured retailers (Zachys, Benchmark, and the five added in Phase 6.7) are unaffected.

**Chosen fix — a generic score-citation pattern as the primary anchor, not a known-publication list (revised 2026-07-24):** The first pass at this fix anchored windowing on `CRITIC_KEYWORDS` matches — extraction only looked at text near a publication/critic name the app already knew about. That's the wrong shape for what's actually wanted: any attributed score on a page should be captured regardless of whether its publication is one the developer has configured yet. Trust between publications ("Wine Advocate matters more to me than a site I've never heard of") is the developer's own downstream judgment call, not something that should gate whether the data gets captured at all. This wasn't a hypothetical concern: cross-referencing the wines already in the test collection (Barolo, Rioja) against real critic coverage for those regions turned up Tim Atkin (the defining critic for Rioja/Spain), Guía Peñín (Spain's own domestic 100-point guide), Kerin O'Keefe (Wine Enthusiast's Italy critic), and Gambero Rosso (Italy's domestic guide) — none of which were in the original Burgundy/Bordeaux-sourced keyword list. A keyword-gated anchor would have silently missed real, correctly attributed scores on exactly the kind of wine this app is meant to cover.

So the primary anchor is now a generic, publication-agnostic score-citation pattern: a number in a plausible critic-score range (50–100, or a range/plus form like "94-96" / "94+") adjacent to a scoring word ("points", "pts", "/100", "score"), in either ordering ("96 points" or "Points: 96"). This catches a citation's *shape* — number, scoring word, nearby attribution text — without needing to already know the critic or publication involved. `CRITIC_KEYWORDS` no longer gates whether a window gets extracted; it's applied afterward, purely to canonicalize whatever attribution text GPT-4o returns and to flag whether that attribution is already known (see below). An attribution that doesn't match anything in the list still gets captured and stored under its own raw text — a regional guide the developer hasn't configured yet shows up rather than being silently dropped.

A capped full-page fallback (stripped of `<script>`/`<style>`/`<svg>` tags and HTML comments, then truncated at 280,000 characters — verified sufficient for both the Zachys and Benchmark pages after stripping) is still used if the generic pattern finds zero matches at all on a page, so a genuinely unusual citation format still gets a shot at extraction rather than silently returning nothing. This should trigger far less often than it would have under the old keyword-gated design, since the generic pattern doesn't depend on the developer having pre-configured the right names.

This is also the direct answer to the cost problem: each retailer's GPT-4o call is billed independently (`reviews/index.ts` runs one `extractFromRenderedHtml` call per retailer via `Promise.all`, never batched), so a blind 280K-character cap across up to eight configured retailers could run close to $1.40 for one manual "Fetch Reviews" click. Windowing around actual score citations — known or unknown publication alike — sends only the few thousand characters actually surrounding each one, typically well under even the original 80K budget regardless of how large or bloated the source page is, which matters because this app is expected to cast a wide net across all eight retailers routinely, not just spot-check one at a time.

**`CRITIC_KEYWORDS` (`backend/modules/reviews/critic-keywords.ts`) — canonicalization and known/unknown tagging, not a gate (revised 2026-07-24):**

Given whatever attribution text GPT-4o extracted alongside a score, this config is consulted afterward to (a) normalize it to one canonical publication name if it matches an entry, and (b) mark the result `known_publication: true` if so, `false` otherwise — raw attribution text is preserved either way (see the schema addition below). It plays no part in deciding whether a window gets extracted in the first place; the generic score pattern above does that job now.

This is still living data, and still needs periodic updates — critics change publications on a timescale of a couple of years (William Kelley became The Wine Advocate's Editor-in-Chief in April 2024, succeeding Joe Czerwinski, who'd held the role only since December 2021; Neal Martin moved from Wine Advocate to Vinous in 2022) — but a miss here is now low-stakes: an unrecognized publication still shows up in `review_data`, just unnormalized and flagged `known_publication: false`, rather than being silently dropped the way it would have been under the gated design. Same principle as `RETAILER_CONFIG`: a plain data array, imported by the logic that uses it, never inlined into that logic.

Structure:
```typescript
export interface CriticKeyword {
  term: string        // exact text to match against extracted attribution (case-insensitive)
  publication: string // canonical publication name to normalize to
}
```

Known entries, Burgundy/Bordeaux/Rhône-sourced (original research): Wine Advocate, Vinous, Burghound, Wine Spectator, James Suckling, Decanter, Wine Enthusiast, Jeb Dunnuck, International Wine Cellar (legacy, folds into Vinous), plus critic surnames Kelley, Galloni, Neal Martin, Dunnuck, Allen Meadows, Parker, Suckling, Tanzer, Czerwinski, Perrotti-Brown, plus abbreviations WA, JS, RP, BH, JD, WS, WE.

Added 2026-07-24 for regional coverage already known to be needed (Barolo, Rioja — both in the test collection): Tim Atkin (independent, Rioja/Spain's defining critic), Guía Peñín / Peñín Guide (Spain's domestic guide), Kerin O'Keefe → Wine Enthusiast (Italy critic), Luis Gutiérrez → Wine Advocate (Spain critic), Gambero Rosso → Gambero Rosso (Italy's domestic guide, abbreviation GR).

**Two-step workflow:**

**Step 1 — Find the product page** (`backend/modules/reviews/find-product-page.ts`)
- Build a query from the wine entry and a retailer's domain: `site:<domain> "<producer>" "<denomination>" <vintage>`
  > **Corrected in Phase 7.1 (2026-07-26):** appending the vintage here caused false negatives when a retailer carried the wine only under a different vintage's page (observed on Zachys/Clos des Papes). Phase 7.1 drops the vintage from this query and adds vintage-aware ranking of the results that come back instead. See Phase 7.1 for the full fix.
- Send it to Serper's organic search endpoint: `POST https://google.serper.dev/search` with `{ q: "site:<domain> \"<producer>\" \"<denomination>\" <vintage>", gl: "us" }`
- Response is a list of `{ title, link, snippet }` organic results
- Filter/rank results using `isRelevantMatch`-style logic against `title` + `snippet` (reimplemented locally — modules don't import from each other, per `CLAUDE.md` §5), checking for producer + denomination text
- Return the `link` of the best match, or null if nothing relevant is found
- No request is made to the retailer's own site in this step

**Step 2 — Render and extract** (`backend/modules/reviews/index.ts`)
- For each configured retailer, if Step 1 returned a URL, render that specific product page with Puppeteer (15-second timeout, standard browser user agent — same conventions as the price module)
- Strip `<script>`, `<style>`, `<svg>` tags and HTML comments from the rendered HTML (`keyword-window.ts`) — removes the largest sources of page bloat (SPA tracking payloads, inline CSS) without touching visible text or attributes like `alt` text
- Search the stripped text for the generic score-citation pattern (a number 50–100, or a range/plus form, adjacent to "points"/"pts"/"/100"/"score" — see architecture decision above) and extract a bounded window of text around each hit; merge overlapping/nearby windows and concatenate in document order, capped at a combined length safety net. This anchor does not require the nearby attribution to be a publication the app already knows about.
- If zero score-pattern matches are found, fall back to the stripped HTML truncated at 280,000 characters, so an unusual citation format still gets a real extraction attempt rather than silently returning nothing
- Pass the windowed (or fallback capped) text to GPT-4o extraction via `gpt-extract.ts` (moved from `backend/modules/price/`, then updated 2026-07-24 to accept pre-windowed text instead of doing its own blind 80K slice — see deliverables below)
- Output: `{ critic_scores: [{ publication, score, known_publication }] }`. Never infer or hallucinate attribution. Never extract tasting-note prose (copyright boundary — numbers only). After GPT-4o returns whatever attribution text it found (a full publication name, a critic surname, an abbreviation, or something the app has never seen), look it up against `CRITIC_KEYWORDS` in code: on a match, normalize to the canonical publication name and set `known_publication: true`; on no match, keep the raw attribution text as `publication` and set `known_publication: false` — captured either way, never dropped for being unrecognized
- Store per-retailer result: `{ slug, name, product_url, critic_scores, fetched_at }`
- Runs async, does not block the price/scan flow
- Each retailer is independent — if one fails (no match in Step 1, render timeout, no attributed score found), the others continue. K&L is expected to always fail here (bot-blocked at the product-page render, not just the search page — see architecture decision above); this is expected, not a bug to chase.

**Deliverables:**

1. **Move `retailers.config.ts`** from `backend/modules/price/` → `shared/config/retailers.config.ts`. Both `price` and `reviews` need the same retailer metadata (slug, name, domain, coordinates); modules can't import from each other, so shared config has to live in `shared/`. No behaviour change to the price module — only the import path changes.
2. **Move `gpt-extract.ts` and `PROMPT.md`** from `backend/modules/price/` → `backend/modules/reviews/`. This code has been dead in `price/` since the 2026-07-19 fixes removed the Step 2 GPT-4o call there (it was a structural no-op against search-results pages).
3. **New file** `backend/modules/reviews/critic-keywords.ts` — the `CRITIC_KEYWORDS` lookup table described in the architecture decision above (full publication names, critic surnames, and abbreviations, each mapped to a canonical `publication` name). Used only for post-extraction canonicalization and known/unknown tagging — never consulted before a window is extracted. Config-driven, same principle as `RETAILER_CONFIG`: adding a newly discovered critic or publication is a one-line addition here, never a change to matching logic.
4. **New file** `backend/modules/reviews/keyword-window.ts` — strips `<script>`/`<style>`/`<svg>` tags and HTML comments from rendered HTML, searches the result for the generic score-citation pattern (number + scoring word, publication-agnostic), extracts and merges bounded windows around each hit, and falls back to the stripped text truncated at 280,000 characters if no score-pattern matches are found.
5. **Update `gpt-extract.ts`** — no longer does its own `html.slice(0, 80_000)`; instead receives the already-windowed (or fallback-capped) text from `keyword-window.ts`. After GPT-4o returns each `{ publication, score }` pair, look up the returned `publication` string against `CRITIC_KEYWORDS`: normalize and set `known_publication: true` on a match, otherwise keep the raw text and set `known_publication: false`.
6. **New module** `backend/modules/reviews/`:
   ```
   reviews/
   ├── index.ts               # Orchestrates Step 1 (Serper) and Step 2 (Puppeteer + windowing + GPT-4o)
   ├── find-product-page.ts   # Serper organic search + relevance matching
   ├── critic-keywords.ts     # CRITIC_KEYWORDS lookup — canonicalization/known-tagging only, living data (2026-07-24)
   ├── keyword-window.ts      # HTML stripping + generic score-pattern windowing + capped fallback (2026-07-24)
   ├── gpt-extract.ts         # Moved from price/, updated 2026-07-24 to accept pre-windowed text + canonicalize output
   ├── PROMPT.md              # Moved from price/ — unchanged
   ├── types.ts
   └── reviews.test.ts
   ```
7. **Schema addition** — `review_data` TEXT column on `wines`: JSON array, `[{ slug, name, product_url, critic_scores: [{ publication, score, known_publication }], fetched_at }]`. `known_publication` is `true` when `publication` was normalized via `CRITIC_KEYWORDS`, `false` when it's raw text from an attribution the app didn't already recognize — this is what lets a future UI pass distinguish trusted/known sources from unvetted ones without re-deriving it at display time. Nullable column; empty array if no retailer returned a match. This is a real new column — an actual `ALTER TABLE wines ADD COLUMN review_data TEXT` migration, unlike `price_data`/`retailer_links` which already exist (see Phase 5 schema note).
8. **Remove `critic_scores` from the `retailers` array shape** inside `price_data` (in the price module's types) — it has been a guaranteed-empty field since the 2026-07-19 fixes and is being replaced by `review_data`. This is a type-level change only (JSON blob shape, not a DB migration) but should ship in the same PR to avoid the two fields coexisting in a confusing half-dead state.
9. **Repoint the wine detail view** (`WineDetailModal` — the actual shipped component name; corrected 2026-07-26, built in Phase 6.5) — the "Critic scores" row currently reads from `price_data.retailers[].critic_scores`, which can never populate that field. Update it to read from `review_data` instead. This is a required fix, not a deferred one — the row has been silently broken since Phase 6.5 shipped.

**Graceful degradation:**
- Serper returns no relevant organic result for a retailer → skip that retailer for that wine, no error
- Puppeteer render of the product page times out (15s) → skip that retailer, others continue — this is the expected outcome for K&L specifically (bot-blocked at render), not treated as a fault
- No score-citation pattern matches found on a rendered page → fall back to stripped-and-capped (280K) full-page text, not an error
- GPT-4o finds no attributed score on a rendered page (windowed or fallback text) → `critic_scores: []`, not an error
- `SERPER_API_KEY` or `OPENAI_API_KEY` not configured → module returns empty `review_data`, no error (consistent with existing modules)

**Tests:**
- Unit: relevance matching correctly picks the right organic result from fixture Serper responses (match and no-match cases)
- Unit: `keyword-window.ts` — the generic score pattern matches both orderings ("96 points", "Points: 96") and range/plus forms ("94-96", "94+"); matches a citation from a publication not in `CRITIC_KEYWORDS` at all (proving capture isn't gated on the known list); overlapping windows are merged rather than duplicated; zero-match input correctly falls through to the stripped/capped fallback
- Unit: GPT-4o extraction returns correct structure from windowed-text fixtures, including: known-publication canonicalization (a window containing "Kelley: 96" normalized to `{ publication: "Wine Advocate", known_publication: true }`) and unknown-publication passthrough (a window citing a publication not in `CRITIC_KEYWORDS` returns the raw attribution text with `known_publication: false`, not dropped)
- Unit: graceful degradation — no API key, no match, render timeout — all return empty/null without throwing
- Integration: end-to-end with mocked Serper response + mocked product-page HTML fixture — verify `review_data` is correctly populated on the wine entry
- Regression fixtures: the three real rendered pages captured during the 2026-07-24 live test (K&L's ~2,600-character bot-detection stub, Zachys's 879,212-character page, Benchmark's 189,524-character page) are known-good/known-bad cases — use them directly as fixtures rather than synthesizing new ones, since they already demonstrate the failure this rework fixes
- Do not run Puppeteer in CI — mock with HTML fixtures, same rule as Phase 6

**Notes:**
- This is the natural home for the professional-review BYOK question (Burghound, Vinous, Wine Advocate) if a viable individual-subscriber path ever emerges — see "Open questions affecting phases"
- The `CRITIC_KEYWORDS` list is expected to need periodic updates as critics change publications or new ones are added to what the developer tracks — treat this the same way Phase 9 treats retailer search-URL liveness: an ongoing maintenance item, not a one-time build task. Because capture no longer depends on this list (see architecture decision above), a stale entry only means a publication shows up unnormalized/`known_publication: false` rather than missing entirely — lower stakes than before, but still worth tidying up periodically. See "Open questions affecting phases."

**Phase 7 completion criteria — manual test required:**
1. A real wine bottle already in the database (with existing price data from Phase 6) is run through the reviews module
2. Inspect: `sqlite3 backend/db/wine.db "SELECT review_data FROM wines WHERE id = '<id>';"`
3. At least one retailer entry in `review_data` has a non-empty `critic_scores` array, sourced from an actual rendered product page (not a search-results page). K&L is not expected to contribute and its absence does not block this criterion — see the K&L decision above.

Document the test result in the session summary (which wine, which retailers responded).

**Branch:** `service/review-score-sourcing`
**PR title:** `service: review & critic score sourcing (Phase 7)`

**Milestone:** A real wine entry shows at least one attributed critic score sourced from an actual rendered retailer product page (not a search-results page) — the counterpart to Phase 6's completion test, for scores instead of price. `review_data` is populated independently of `price_data`. The wine detail view's critic scores row displays correctly for the first time since Phase 6.5.

---

## Phase 7.1 — Retailer search query genericization (price + reviews)

> **RETRACTED — no bug confirmed (2026-07-26):** Claude Code tested the specific mechanism described below against real live queries before implementing, and it did not reproduce for the exact case cited as evidence (Zachys / Clos des Papes / 2020): Serper's organic search found the correct 2020 listing near the top whether or not the vintage was included in the query; Zachys's own on-site search returned 140+ results for both the vintage-qualified and vintage-free URLs; and the actual production `pageShowsNoResults()` function returned `false` (no false "no results" signal) against both real rendered pages. No code was changed.
>
> Source of the original observation, confirmed with the developer: the "4 correct results across vintages" behavior was seen by typing "Clos des Papes" directly into Zachys.com's own search bar in a browser — a manual test of the retailer's website, not a run of the app's price or reviews module. That observation is actually consistent with Claude Code's findings, not in tension with them: Zachys's search is broad/fuzzy and returns a wide result set regardless of an added vintage token, which is exactly what both tests found. The inference that the *app's* query construction must therefore be "too specific" and dropping results doesn't hold — nothing demonstrates the app itself producing a false negative for this retailer.
>
> Conclusion: no code fix is warranted from what's been shown so far. This section is retracted, not merely pending — treat it as closed unless a real run of the price or reviews module (not a manual retailer-website search) is observed returning a missing or empty result for a wine known to be in stock. Left in place, unedited below, as a record of what was tried and disproven.
>
> **Update (2026-07-26, later same day):** the real bug surfaced separately — the developer directly clicked the "Find Reviews" search button in the UI (not a manual retailer-website search) and got zero results for Clos des Papes at Zachys, then confirmed a simplified manual query worked. That button's query is built by `backend/modules/retailer-links/index.ts`, a *third* independent copy of this query-building logic distinct from both `price/retailer-search-url.ts` (what was tested above) and `reviews/find-product-page.ts` — the three modules each maintain their own copy per `CLAUDE.md` §5, and they'd drifted. See **Phase 7.2** for the confirmed fix and the guided-confirmation workflow built around it.

**Goal:** Fix a shared false-negative bug: both the price module's retailer-search verification and the reviews module's product-page discovery build their search query by appending the wine's vintage as a literal token, and neither Zachys's own site search nor Google's `site:`-restricted organic search reliably matches on that exact combination — even though the retailer clearly carries the wine, just possibly under a different vintage's listing. Query construction was too specific; this phase makes it generic where it needs to be, while preserving the vintage-aware tagging that already exists downstream.

**Context (found 2026-07-26):** Manually searching Zachys for "Clos des Papes" (no vintage) returns four correct product-page results — all genuinely Clos des Papes Châteauneuf-du-Pape, just for different vintages. That's the desired outcome: the retailer does carry the wine, across several vintages, and any of those pages is a legitimate candidate. But both modules that search retailers programmatically append the vintage to the query before searching, which risks returning nothing when the exact vintage phrase isn't indexed the way a plain-name search is — a false negative, not evidence the retailer doesn't carry the wine.

This is the same root-cause pattern in two places:

1. **Price module (`backend/modules/price/index.ts`)** — `buildQuery()` builds one combined string (`producer + denomination + vintage`) used both for the Serper Shopping API call and, via `serper-query.ts` → `retailer-search-url.ts`, for the constructed URL that `verify-listing.ts` renders to confirm a retailer's live search still backs up Serper's price (`verifyStillListed` / `pageShowsNoResults`). Google Shopping's own ranking is relevance-based and tolerant of the extra vintage token — that part isn't the problem. A retailer's own on-site search box is typically far more literal, so the vintage-qualified query risks `pageShowsNoResults` returning true (or simply not surfacing a result) even when the retailer's page is real and current, just for a different vintage — and `verifyStillListed` then drops the retailer entirely instead of surfacing it with a `vintage_mismatch` badge, which is exactly the mechanism already built to handle this correctly once a result comes back.
2. **Reviews module (`backend/modules/reviews/find-product-page.ts`)** — `buildQuery()` appends the vintage (unquoted) to the Serper organic `site:`-restricted query. Same risk: if the exact vintage isn't indexed the way the query expects, Step 1 returns nothing for a retailer that clearly carries the wine under a different vintage's page — which then never gets a chance to be rendered or checked for a critic score in Step 2 at all.

**Fix — drop vintage from the query used to search, keep (or add) vintage matching in the ranking/tagging step that follows:**

**Price module:**
- `itemToRetailerResult()` and `buildFallbackResult()` (`serper-query.ts`) already receive the `wine: WineIdentity` object and already compute `matched_vintage` / `vintage_mismatch` from the Serper Shopping item's own title — that logic is correct and unchanged. The only change: when calling `buildRetailerSearchUrl(retailer, query)` / `buildFallbackUrl(item.source, query)`, use a vintage-free query (`producer + denomination` only, derived from `wine.producer`/`wine.denomination` already in scope) instead of the vintage-qualified `query` string threaded in from `index.ts`. The Serper Shopping call itself (`index.ts`'s `fetchPriceData`, `querySerper(query, ...)`) keeps the full vintage-qualified query unchanged — that call goes to Google's own relevance-ranked index, not a retailer's own search box, and isn't the part that's failing.
- No change to `verify-listing.ts` itself — `pageShowsNoResults` just now renders a page built from a query that reliably surfaces the retailer's real listings, so a genuine "no results" signal means what it says.

**Reviews module:**
- `find-product-page.ts`'s `buildQuery(wine, domain)` drops the vintage token: `site:<domain> "<producer>" "<denomination>"` only.
- Since this can now return organic results spanning multiple vintages (as directly observed for Zachys), `findProductPage()` needs the same vintage-ranking step the price module already has: parse a vintage year from each relevant result's `title` + `snippet` (reimplemented locally, same convention as `isRelevantMatch` already is in this file — modules don't import from each other), prefer the result whose parsed vintage matches `wine.vintage` exactly, and fall back to the first relevant match if no exact vintage is found — never return null just because the specific vintage isn't available, matching the price module's "never drop for vintage, tag it instead" principle.
- `findProductPage()`'s return value needs to carry that mismatch signal forward, since Step 2 renders whatever page Step 1 returns, and a critic score from a different vintage's page shouldn't be presented as if it's for the vintage in the cellar. Change the return type from `string | null` to `{ url: string; matched_vintage: number | null; vintage_mismatch: boolean } | null`.
- `reviews/index.ts` carries `matched_vintage` / `vintage_mismatch` through into the stored per-retailer result: `{ slug, name, product_url, critic_scores, fetched_at, matched_vintage, vintage_mismatch }` — same field names as the price module's `RetailerResult`, for consistency across both modules.
- `review_data`'s JSON shape gains these two fields per retailer entry. This is a type-level/JSON-shape change only (still the same `review_data` TEXT column from Phase 7) — no new migration required.

**Deliverables:**
1. `backend/modules/price/serper-query.ts` — `itemToRetailerResult()` and `buildFallbackResult()` build the retailer-search URL from a vintage-free query derived from `wine.producer`/`wine.denomination`, not the vintage-qualified `query` parameter. `index.ts`'s Serper Shopping call is unchanged.
2. `backend/modules/reviews/find-product-page.ts` — `buildQuery()` drops the vintage token. Add a locally-reimplemented year-extraction helper (same pattern as `extractYearFromTitle` in the price module's `serper-query.ts` — not imported, since modules don't import from each other). `findProductPage()` ranks relevant results by exact-vintage match first, falls back to the first relevant match otherwise, and returns `{ url, matched_vintage, vintage_mismatch }` instead of a bare URL string.
3. `backend/modules/reviews/index.ts` and `types.ts` — thread `matched_vintage` / `vintage_mismatch` from Step 1 into the stored per-retailer `review_data` entry.
4. Re-run the Phase 6 and Phase 7 manual completion tests against Clos des Papes specifically (the wine that surfaced this bug) to confirm: the price module no longer drops Zachys for this wine, and the reviews module finds and renders a product page (exact vintage if available, otherwise the closest available vintage, correctly flagged) instead of returning nothing.

**Tests:**
- Unit: `buildRetailerSearchUrl`/`buildFallbackUrl` receive a vintage-free query even when the wine has a known vintage
- Unit: `serper-query.ts`'s existing `matched_vintage`/`vintage_mismatch` computation is unaffected (still derived from the Serper Shopping item's own title, not from the query)
- Unit: `find-product-page.ts` — a fixture Serper organic response with multiple vintage-variant results correctly prefers the exact-vintage match; a fixture with no exact-vintage match falls back to the first relevant result with `vintage_mismatch: true` rather than returning null
- Integration: mocked Zachys-style fixture reproducing the observed case (query without vintage returns 4 relevant results across vintages) — confirm the module selects a page and doesn't return empty-handed
- Regression fixture: capture the actual Clos des Papes / Zachys organic search response that surfaced this bug and use it directly as a test fixture, same practice as the three real HTML pages captured for the Phase 7 windowing fix

**Notes:**
- This does not change `isRelevantMatch` in either module — producer/denomination relevance filtering is a separate, already-correct concern from vintage specificity. Only the vintage token's role changes: it moves from a query-time hard filter (causing false negatives) to a post-hoc ranking/tagging signal (already proven correct in the price module, now applied the same way in reviews).
- This is a targeted bug fix inside already-shipped Phase 6 and Phase 7 modules — it does not change either phase's completion status, milestone, or external interface beyond the two per-retailer vintage fields added to `review_data`.

**Branch:** `fix/retailer-search-query-genericization`
**PR title:** `fix: drop vintage from retailer search queries, rank by vintage post-hoc instead`

**Milestone:** Searching for a wine known to be carried under multiple vintages (Clos des Papes at Zachys) no longer returns a false negative in either the price module or the reviews module — the retailer surfaces correctly, tagged with `vintage_mismatch` when the matched page isn't the exact vintage in the cellar, instead of disappearing from results entirely.

---

## Phase 7.2 — Guided retailer search with confirmed-URL extraction

**Goal:** Fix the real, now-confirmed bug behind the original report, and build the manual fallback workflow it was actually pointing at. The "Find Reviews" button's generated search URL includes the wine's vintage; for Clos des Papes at Zachys this returns zero results on Zachys's own site, even though a plain producer + denomination query returns the correct listing (confirmed directly by the developer clicking the button, then manually simplifying the search). Beyond the query fix, replace the current "open a link, then maybe remember to paste a URL back later" behavior with a guided one: click search → find the product yourself → copy its URL → switch back to the app → the app notices and offers to save it → saving immediately extracts price, vintage, and critic scores from that exact page.

**Root cause, now correctly identified:** The button's search URL is generated by `backend/modules/retailer-links/index.ts`'s `buildQuery()`, which appends the vintage — a *third*, independently-duplicated copy of the same query-building pattern already present in `backend/modules/price/index.ts` and `backend/modules/reviews/find-product-page.ts` (each module maintains its own copy per the "modules don't import from each other" convention in `CLAUDE.md` §5, and the three copies had drifted apart). Phase 7.1's retraction tested the *price* module's on-site search behavior (`price/retailer-search-url.ts`, exercised via `verify-listing.ts`) and found nothing wrong — correctly, but that's a different module's copy of similar-looking code, not the one behind the actual button. The developer's own reproduction (click button → zero results; simplify query manually → correct results) is the real signal, and it points at `retailer-links/index.ts` specifically.

**UX intent — this is a fallback, reached for when automation comes up empty, not a parallel always-on path:** Phase 7's fully-automated discovery (Serper organic search → Puppeteer → GPT-4o, no human involved) is unchanged and continues to run as the default. When it finds a match and GPT-4o extracts a score, that automated result takes precedence — this phase does not second-guess or override it. The primary use case for the guided manual flow is the opposite case: automation returned nothing for a wine, and the developer wants to personally check the retailers they trust rather than accept an empty result. The UI should make this legible — for a retailer where `review_data` already has a result, show it; for a retailer where automation found nothing, that's exactly where the "Search <Retailer>" button becomes the primary next action, not a redundant option sitting next to an automated result that already answered the question.

**Deliverables:**

1. **Broaden the button's query.** `backend/modules/retailer-links/index.ts`'s `buildQuery()` drops the vintage token — `producer + denomination` only. This directly fixes the observed failure without depending on further reproduction of exactly why Zachys's search behaves this way for this specific combination; it matches the query the developer confirmed works when searching manually.

2. **Guided-confirmation flow, replacing today's one-way "click button, hope to remember to paste a URL back" behavior:**
   - User clicks "Search <Retailer>" for a wine where automated review sourcing found nothing — opens the (now broader) search URL in the default browser, same as today otherwise.
   - User finds the correct product on the retailer's site and copies its URL (standard browser action — address bar copy, or right-click → Copy Link).
   - User switches back to the app tab. On regaining focus/visibility (`document.visibilitychange` / `window.onfocus`), the web app checks the clipboard (`navigator.clipboard.readText()`, behind a one-time permission grant) for a URL whose hostname matches the retailer that was just searched. The app needs to track, client-side, which retailer/wine a search was just opened for, so it knows what to check the clipboard against.
   - If a matching URL is found, show a lightweight confirmation ("Save this Zachys product link for [wine]?"). If clipboard read fails, permission is denied, or no matching URL is found, fall back to a manual "paste URL" field so the flow can still be completed — graceful degradation, not the primary path.
   - On confirmation, the URL is saved (existing `retailer_links` mechanism, via `PATCH /:id`) and immediately triggers extraction against that exact page — no separate "now click Extract" step.

3. **New extraction endpoint/orchestration** (`backend/routes/wines.ts` — the route layer can import from both `price` and `reviews`, which can't import from each other): `POST /:id/confirm-retailer-link` given `{ slug, url }`:
   - Renders `url` with Puppeteer (reuse `reviews/puppeteer-extract.ts`'s `renderPageHtml`).
   - Runs the existing keyword-window + GPT-4o extraction pipeline (`reviews/keyword-window.ts` + `reviews/gpt-extract.ts`), extended to also extract the vintage stated on the page — `gpt-extract.ts`'s output shape and prompt gain a `vintage: number | null` field alongside the existing `price`, `url`, `critic_scores`.
   - Writes results to **both** schemas from this single extraction, since the existing UI reads price from `price_data` and scores from `review_data` separately: updates (or inserts) this retailer's entry in `price_data.retailers[]` (`price`, `url` now the real product page, `is_search_results_page: false`, `matched_vintage`, `vintage_mismatch`) and this retailer's entry in `review_data` (`product_url`, `critic_scores`, `fetched_at`), then recomputes `price_data.price_min`/`price_avg`/`price_max`/`nearest_retailer` the same way `fetchPriceData` already does.
   - Also saves the confirmed URL into `retailer_links[slug]`, same as today's manual-save mechanism.

4. **Frontend (`WineDetailModal.tsx`):** track "awaiting confirmation for retailer X on wine Y" client-side state when a search button is clicked; add the focus/visibility listener + clipboard check + confirmation UI + manual-paste fallback; call the new confirm endpoint on save. Surface the "Search <Retailer>" affordance as the primary action specifically for retailers where `review_data` has no entry yet — not as a redundant option next to an already-populated automated result.

**Graceful degradation:**
- Clipboard permission denied → manual paste field is shown instead, no error
- Clipboard has no URL matching the searched retailer's domain → no confirmation prompt appears; manual paste field remains available
- Puppeteer render or GPT-4o extraction fails on a confirmed URL → the URL is still saved to `retailer_links` (so the user doesn't lose their find), but no price/vintage/score data populates; treat as retryable, not a lost state

**Known limitation, found 2026-07-26 during implementation:** `keyword-window.ts` windows the rendered page around score citations, which is exactly right for critic scores but means price text sitting outside those windows never reaches GPT-4o. On the real Clos des Papes / Zachys test, this correctly extracted 5 critic scores but returned `price: null`, even though a price was visible on the page — not a bug (the extraction prompt correctly returns null rather than guessing at a price it wasn't shown), but a real gap if price accuracy on confirmed links ever matters as much as the scores do. Not fixed here; worth its own pass (e.g. a second, separate price-anchored window, or including a fixed head/price-region slice of the page alongside the score windows) if it turns out to matter in practice.

**Tests:**
- Unit: `retailer-links/index.ts`'s `buildQuery()` no longer includes vintage
- Unit: confirm-URL extraction correctly writes to both `price_data.retailers[]` and `review_data`, and recomputes aggregate price stats
- Unit: extraction prompt/shape returns `vintage` alongside existing fields; graceful null when not statable from the page
- Integration: mocked confirm-flow end to end — given a URL, verify both schemas update correctly
- Frontend: clipboard-check-on-focus logic (mock `navigator.clipboard`, mock visibility change) triggers the confirmation prompt only when the clipboard URL's hostname matches the pending retailer, and only surfaces as the primary action when `review_data` has no entry for that retailer

**Manual completion test:**
1. Click "Search Zachys" for Clos des Papes — confirm the opened URL no longer includes a vintage token and returns real results (not zero)
2. Manually find and copy the correct product URL, switch back to the app, confirm the save prompt appears and the save completes
3. Confirm price, vintage, and critic scores (if present on the page) populate on the wine entry from that single confirmed URL, and that this didn't touch or override any retailer where automated review sourcing had already found a result

**Branch:** `feature/guided-retailer-search`
**PR title:** `feat: guided retailer search with confirmed-URL extraction`

**Milestone:** The "Find Reviews" button's search reliably returns results for wines carried under a different vintage (fixing the originally reported Zachys/Clos des Papes failure). For a retailer where automated review sourcing found nothing, manually confirming the correct product extracts price, vintage, and critic scores from that exact page and populates both the price and review sections of the wine entry — without needing separate manual re-entry, and without overriding any retailer where automation already succeeded.

---

## Phase 7.3 — Open-web fallback for review sourcing + retailer list expansion

**Context (decided 2026-07-29):** Two things prompted this phase together, both about where attributed critic scores can come from. First, Phase 6.7's four tri-state retailers (Sokolin, Acker Wines, Wine Library, Morrell & Company) were fully specced and vetted back on 2026-07-20 but never actually landed in `shared/config/retailers.config.ts` — the phase's own "status check" note flagged this gap as of 2026-07-26. That gap is closed as part of this phase. Second, the developer flagged three more retailers with a personal shopping relationship and consistent review coverage — Crush Wine & Spirits, Flatiron Wines & Spirits, and Thatcher's Wine — and asked whether review sourcing could be opened up past a fixed named list altogether, since the actual goal (attributed expert reviews) doesn't depend on which retailer happens to host them.

**Goal:** Two changes, one config and one architectural. Config: bring `RETAILER_CONFIG` to eleven retailers — the original four, Phase 6.7's four, and three developer-nominated ones. Architecture: give the reviews module (Phase 7) an open-web fallback pass, so review sourcing isn't limited to whatever's in the configured list at all — mirroring the price module's existing Pass 1 (preferred) / Pass 2 (open fallback) pattern, which the reviews module never had.

**Deliverables:**

1. **`shared/config/retailers.config.ts` expanded to eleven retailers** (landed 2026-07-29): Sokolin (`sokolin.com`, Bridgehampton NY), Acker Wines (`ackerwines.com`, Manhattan), Wine Library (`winelibrary.com`, Springfield NJ), Morrell & Company (`morrellwine.com`, Briarcliff Manor NY) — closing the Phase 6.7 gap — plus Crush Wine & Spirits (`crushwineco.com`, Manhattan), Flatiron Wines & Spirits (`nyc.flatiron-wines.com` — the NYC-specific subdomain, not the shared root domain that also serves their SF store), and Thatcher's Wine (`thatcherswine.com`, Brentwood/LA — not tri-state, included for review coverage only, will essentially never win nearest-retailer ranking). Each new entry includes a `matchKeyword` for Serper shopping-source matching, consistent with the existing four.
   - **Not yet done for any of the seven new retailers:** a verified on-site search URL pattern. `price/retailer-search-url.ts` and `retailer-links/build-search-url.ts` both fall through to a generic `https://<domain>/search?q=` guess for any slug not in their explicit switch statement — unverified, same caveat Phase 6.7 already flagged for its own four before this phase shipped them. Live-check each with Puppeteer (same method as the original four, Phase 6 2026-07-19) before trusting search-button click-throughs or price-verification against these seven.
2. **Fixed a stale duplicate found while doing the above:** `backend/modules/retailer-links/retailers.config.ts` was a local copy of `RETAILER_CONFIG` that Phase 7's own documentation said would move to `shared/config/` — it never did, so `retailer-links` had been silently stuck at the original four retailers regardless of what the price/reviews modules' shared config contained. Deleted; `retailer-links/index.ts` and `build-search-url.ts` now import `RETAILER_CONFIG`/`RetailerConfig` from `@shared/config/retailers.config` directly, same as `price` and `reviews` already did. `retailer-links.test.ts` updated to expect all eleven slugs.
3. **Open-web fallback pass in the reviews module** (`backend/modules/reviews/find-product-page.ts`, `index.ts`) — **specced here 2026-07-29, but this PR's diff never actually touched either file; the code did not exist despite this document and the PR's own title (#11, "review sourcing open fallback") saying otherwise. Actually implemented 2026-08-02**, prompted by a user question that assumed it was already live and got a description of the current per-retailer-only behavior instead. See `docs/sessions/2026-08-02-review-sourcing-drift-analysis.md` for how this doc/code gap was found — it's the same "written down as done, never verified" failure mode as the code-duplication drift documented there, just between docs and code instead of between two code copies.

   As implemented: when the configured-retailer loop (Step 1 against every `RETAILER_CONFIG` entry) produces zero critic scores for a wine — not zero matched retailers; a retailer whose page rendered but cited no score still counts as "nothing" — `fetchReviewData` (`reviews/index.ts`) runs one additional Serper organic search via `findFallbackProductPage` (`find-product-page.ts`) *without* a `site:` restriction — `"<producer>" "<denomination>" <vintage> review`, exactly as specced, no cuvee/vineyard — and applies the same `isRelevantMatch` relevance filter already used for configured-retailer results (now shared via `@shared/utils/wine-match.ts`, see Phase 7.3's later drift-fix). If a relevant, non-denylisted result comes back, it's rendered with Puppeteer and run through the existing extraction pipeline unchanged, same as specced.
   - **Gated on Pass 1 yielding nothing**, not run unconditionally — implemented as specced (`hasAnyScore` check in `fetchReviewData` before calling `fetchFallbackReview`).
   - **Denylist guardrail:** implemented as `shared/config/denylisted-domains.ts` (`isDenylistedDomain`), applied to fallback candidates before relevance ranking, regardless of what Serper returns.
   - **Store fallback results distinctly:** `ReviewResult`/`RetailerReview` gained `source: 'configured' | 'fallback'` (backend and shared types). Configured-retailer results (both automated and `confirm-retailer-link`'s manual confirmation) are tagged `'configured'`; the fallback result is tagged `'fallback'` and given a synthesized slug/name derived from the result's domain (e.g. `fallback-amsterwine-com`), since it isn't backed by a `RETAILER_CONFIG` entry. No UI built yet to visually distinguish the two — the field exists, display is still open.

**Graceful degradation:** As specced — the open fallback finding nothing relevant returns no additional result, not an error. A wine already fully covered by a configured retailer never triggers the fallback call at all.

**Tests (implemented 2026-08-02, `backend/modules/reviews/reviews.test.ts`):**
- Unit: the fallback pass is not triggered when a configured retailer already returned a critic score (asserted via a request-count check: no Serper query without a `site:` token was ever sent)
- Unit: the fallback pass excludes CellarTracker/WineBerserkers domains even when Serper returns them as organic results
- Unit: a `review_data` entry sourced via fallback is tagged `source: 'fallback'`; a configured-retailer entry is tagged `source: 'configured'`
- Integration-style: mocked Serper organic response (no `site:` restriction) + mocked product-page HTML — a fallback result populates `review_data` when every configured retailer returns nothing
- Unit: fallback pass returns no additional result (not an error) when it also finds nothing

**Phase 7.3 completion criteria — all done as of 2026-08-02:**
1. ~~Confirm all retailers appear in both `RETAILER_CONFIG` and the "Search <Retailer>" buttons rendered by `retailer-links`~~ — covered by `retailer-links.test.ts`.
2. ✅ **Done 2026-08-02, live `fetchReviewData` run, real Serper/Puppeteer/OpenAI:** `2018 Château du Petit Thouars Chinon L'Epée` (zero configured-retailer coverage) correctly triggered the fallback pass, which found a relevant open-web page (`wine-searcher.com`) and populated `review_data` with a `source: 'fallback'` entry. Also confirmed on `2015 La Rioja Alta "904 Selección Especial" Gran Reserva Rioja` — K&L rendered but cited no score (correctly still counts as "nothing," per the `hasAnyScore` gate, not "a retailer matched"), the fallback fired, found `thewinestop.com`, and populated a second `source: 'fallback'` entry. (Neither open-web page's rendered text happened to contain an extractable score citation in this run — `critic_scores: []` on both — but the gate-fire-and-populate behavior itself, which is what this criterion tests, is confirmed.)
3. ✅ **Done 2026-08-02, same live-run method:** `Clos des Papes Châteauneuf-du-Pape` (covered by 8 of 12 configured retailers, including JJ Buckley with 7 real critic scores — Decanter 98, Wine Advocate 97, Vinous 96, Jeb Dunnuck 98, and more) correctly did **not** trigger the fallback pass — all 8 results tagged `source: 'configured'`, zero `fallback` entries. Reproduced twice for consistency. Also confirmed on `Screaming Eagle Cabernet Sauvignon 2018` (K&L and JJ Buckley both found real scores, e.g. Wine Advocate 100, James Suckling 100) — fallback correctly stayed dormant there too.

**Branch:** `service/review-sourcing-open-fallback` (original PR #11, retailer-list expansion) → actual fallback-pass code landed 2026-08-02 as PR #14 (`feature/review-sourcing-open-web-fallback`, stacked on `fix/review-query-dedup-and-jj-buckley-gap`) → cherry-picked into `main` via `merge-open-web-fallback-into-main` once the dedup fix's own PR (#13) had already merged separately (squash-merge history made a direct PR from the dedup branch re-show already-merged content, so the fallback-pass commit was cherry-picked onto a fresh branch off `main` instead).
**PR title (original, inaccurate as shipped):** `service: open-web fallback for review sourcing + retailer list expansion (Phase 7.3)`

**Milestone:** `RETAILER_CONFIG` lists twelve retailers as of 2026-08-02 (see `CLAUDE.md` §5), consistently reflected everywhere it's consumed. Review sourcing is no longer limited to a fixed named list — when every configured retailer finds nothing, an open web search gets one attempt before the wine is left with no review data at all. Unit/integration-tested, and now live-end-to-end-verified (completion criteria #2–3 above, real API calls, 2026-08-02). Phase 7.3 is complete.

---

## Phase 8 — Professional review parsing extension (drinking windows, vintage character, value signal) ✅ — live-validated 2026-08-02

**Context — supersedes the original Reddit-based plan (decided 2026-07-28):** This phase was originally scoped as a Reddit API + GPT-4o community-sentiment layer. That plan is retired. Reddit closed self-service Data API registration under its Responsible Builder Policy (announced late 2025); every new OAuth token now requires a manual approval ticket, and personal/hobbyist use cases are reported — via Reddit's own developer community and help documentation — to be rejected or ignored at a high rate, with moderator tooling and funded research prioritized instead. The unofficial `.json` endpoint that would have been a free fallback was itself shut down by Reddit on 2026-05-28 (announced on r/modnews, no deprecation window, confirmed via direct testing returning 403). Reddit's own commercial tier requires a contract, reported at a four-to-five-figure annual minimum, and isn't self-service at any price. Third-party resellers (Apify actors, redditapis.com, and similar) offering self-service pay-per-call access are, by their own descriptions, scraping Reddit's public pages with rotated residential proxies rather than using a licensed relationship — the same category of unauthorized automated access already ruled out for CellarTracker and WineBerserkers (`CLAUDE.md` §15). No option survived that combination of self-service, affordable, and consistent with the project's own ToS principle.

Reassessing the actual goal behind the community layer — balancing professional review scores with independent signal, and specifically filling the gap where professional reviews under-deliver on drinking-window guidance — the decision was to redirect that need at its source rather than keep chasing a community data provider: extend the extraction already running against retailer product pages (Phase 7) to pull more of the structured signal those same pages already contain, rather than add an entirely new external data source. A YouTube-based community-sentiment approach was scoped as a possible alternative and may still be tried — see **Phase 8.5**, a small, explicitly optional PoC, not a dependency of this phase.

**Goal:** Extend the Phase 7 reviews module's GPT-4o extraction — already running against real, rendered retailer product pages — to also capture, per critic citation: a drinking window, a vintage-character read, and an explicit value/deal signal, when the source text states one. No new data source, no new fetch — same rendered pages, same extraction pass, more structured fields pulled from it. Phase 8 is not complete until a real wine entry already in the database (with existing `review_data` from Phase 7) shows at least one of these three new fields populated from a live extraction run.

**Deliverables:**

1. **Extend the GPT-4o extraction prompt** (`backend/modules/reviews/PROMPT.md`, `gpt-extract.ts`) to additionally extract, per score citation window already being processed:
   - `drinking_window`: `{ start: number | null, end: number | null } | null` — a year range, if the citation states one. Extract only years explicitly stated ("drink 2028–2040"); never infer or interpolate.
   - `vintage_character`: one of `below_avg` / `avg` / `good` / `very_good`, or `null` — populated only when the source characterizes the vintage as a whole (not just this specific wine), which critics frequently do even in a single-wine review ("2019 was an excellent vintage in Barolo"). Map the source's own language to the fixed enum; if the source doesn't characterize the vintage broadly, leave null.
   - `deal`: `boolean` — `true` only when the source explicitly signals strong value/QPR ("overdelivers for the price," "great value," "fairly priced"); `false`/absent otherwise. Not inferred from a score-to-price ratio — text-stated only.
   - Same copyright boundary as Phase 7 applies to all three: structured facts only, extracted the same way a numeric score already is. Never quote, paraphrase at length, or store the source's actual sentence — the extraction prompt must explicitly instruct GPT-4o to output the derived fact only, not source text.
2. **Extend `review_data`'s JSON shape** — each entry in a retailer's `critic_scores` array gains the three optional fields above, alongside the existing `{ publication, score, known_publication }`. Type-level change only, same as Phase 7.1's `matched_vintage`/`vintage_mismatch` addition — no new migration required, `review_data` already exists as a column (Phase 7).
3. **Populate the wine-level `drinking_window_start`/`drinking_window_end` and `vintage_rating` columns from `review_data` — without blending across critics** (`CLAUDE.md` §15, "do not blend or synthesise data across sources" — this phase is bound by the same rule Phase 6/7 already follow for price and scores):
   - If exactly one critic in `review_data` provides a drinking window (or vintage character), populate the wine-level field from it.
   - If more than one critic provides a window (or character) and they disagree, leave the wine-level field `null` — do not average, blend, or pick one silently. The UI (once built) is expected to show each critic's window/character distinctly, the same way `critic_scores` already shows each publication's score distinctly, rather than collapsing them into one number.
   - **The wine-level field is user-editable at any time — manually creating or overriding it is always preserved.** This reverses the field's original "cached/derived, never manually set" documentation (see schema section above) — the developer specifically wants to set or correct a drinking window by hand, whether at manual wine-entry creation or later research, and an automated run must never silently overwrite a value the user has set. The adapter must track whether a value was set manually vs. derived (e.g. a provenance marker — implementation detail for whoever builds this) so a later automated extraction pass doesn't clobber it.
4. **UI label note (for whichever phase builds the frontend — Phase 10/11):** `vintage_rating` should be labeled "Year" in the UI, not "Vintage Rating" — developer preference, for clarity. No functional change, just the display label to carry forward into Phase 10's prototypes.
5. **Product page URLs, already captured in `review_data.product_url` since Phase 7, are the durable manual-reference mechanism** — no change needed here, just confirming the existing field already satisfies "let me click through and read the real review myself." Never used to re-fetch or re-render beyond this module's own refresh cycle.

**Explicitly tabled — do not build without revisiting:** A "why" field explaining the reasoning behind a drinking window (e.g. "high tannin, needs time to resolve" vs. "already balanced, no rush") was considered and set aside 2026-07-28. It's less cleanly fact-based than the three fields above — a short reasoning phrase risks drifting into paraphrased or lightly-reworded source prose, a harder line to hold consistently than a date range, an enum value, or a boolean. Revisit only if a reliably structured (non-prose) way to capture it is found — e.g. a fixed set of reasoning categories (tannin-driven, acid-driven, already-balanced) rather than freeform text.

**Graceful degradation:** Same pattern as Phase 7 — a citation window with no drinking-window language present returns `drinking_window: null` for that entry, not an error. No broad vintage characterization on the page → `vintage_character: null`. No value language → `deal: false`. A wine with disagreeing critic windows leaves the wine-level field `null`, an expected state, not a bug — the per-critic data is still present in `review_data`.

**Implemented 2026-08-05 — the step-3 UI expectation, drinking windows only.** `WineCard` and `WineDetailModal` now fall back to the per-critic windows from `review_data` when the wine-level `drinking_window` is `null`, each attributed to the critic who stated it (`web/src/utils/drinkingWindows.ts`, `web/src/components/AttributedDrinkingWindows.tsx`). This is the display behaviour step 3 above already anticipated, not a change to the derivation rule — `derive-wine-level.ts` is untouched, the field still goes `null` on disagreement, and nothing is averaged or collapsed, so §15 stands unamended.

Two notes for whoever picks this up next:
- **`vintage_character` was deliberately left out of this pass.** It is gated by the identical unanimity rule in the same function and has the identical failure mode, but per `build-phases.md` line 906's finding, real citations characterize the specific wine far more often than the vintage as a whole — so `null` there is usually absence of data, not disagreement, and the disagreement display would rarely fire. Worth doing when the UI build revisits the "Year" badge.
- **Fill rate is unchanged.** This makes disagreement visible; it does not make the wine-level field populate more often. How often two or more critics actually state conflicting windows is still unmeasured — nothing counts it. If empty fields on well-covered wines remain the real complaint, measure that before reopening the rule itself.

**Tests:**
- Unit: extraction prompt output shape — `drinking_window`/`vintage_character`/`deal` all correctly parsed from fixture text, and all three correctly return `null`/`false` when the source text doesn't mention them
- Unit: the non-blending rule — a fixture with two critics citing different drinking windows for the same wine correctly leaves the wine-level `drinking_window_start`/`drinking_window_end` `null`, while both critics' windows are still present in their respective `review_data` entries
- Unit: manual-override protection — once a wine's `drinking_window_start`/`drinking_window_end` has been manually set, a subsequent automated extraction run does not overwrite it
- Unit: `vintage_character` only populates from broad-vintage language, not from a wine-specific tasting note that happens to mention a year
- Regression: reuse the same three real HTML page fixtures captured for Phase 7's windowing fix (K&L bot-detection stub, Zachys, Benchmark) to confirm the extended prompt doesn't regress existing `critic_scores` extraction

**Phase 8 completion criteria — ✅ done, live-validated 2026-08-02:**
1. ~~A real wine bottle already in the database (with existing `review_data` from Phase 7) is run through the extended extraction~~ — validated via a direct live `fetchReviewData` call (real Serper/Puppeteer/OpenAI, not mocked) rather than through the app's DB-backed UI flow; the extraction pipeline is identical either way, and criterion #3's "sourced from a real rendered product page, not hallucinated" bar is what actually matters here. See below.
2. Inspect: `sqlite3 backend/db/wine.db "SELECT drinking_window_start, drinking_window_end, vintage_rating, review_data FROM wines WHERE id = '<id>';"` — not run against a DB row for this validation pass (see #1); the populated field was observed directly in the `fetchReviewData` return value instead.
3. ✅ **At least one of the three new fields is populated, sourced from a real rendered product page:** `Clos des Papes Châteauneuf-du-Pape`, retailer JJ Buckley Fine Wines (`jjbuckley`), critic Decanter, score 98, `drinking_window: { start: 2029, end: 2045 }` — extracted live from JJ Buckley's real rendered product page on 2026-08-02. The same run's other six JJ Buckley citations (Wine Spectator, Jeb Dunnuck, TheWineCellarInsider.com, Wine Advocate, James Suckling, Vinous) all correctly returned `vintage_character: null, deal: false` — consistent with commit `4a2bc64`'s (PR #12) prior finding that real citations are almost always wine-specific tasting notes rather than broad vintage assessments, so `null` is the expected common case for those two fields, not a bug.

**Branch:** `service/review-extraction-extension`
**PR title:** `service: extend review extraction — drinking windows, vintage character, value signal (Phase 8)`

**Milestone:** A real wine entry shows drinking window and/or vintage character and/or a value/deal flag, sourced from the same retailer product pages Phase 7 already renders — attributed per critic, never blended, and user-editable without being silently overwritten by a later automated run. Confirmed live 2026-08-02 (see completion criteria above). Phase 8 is complete.

---

## Phase 8.5 — Community sentiment PoC (YouTube)

**Status: optional, exploratory. Not a dependency of Phase 8 or any later phase — build only if there's appetite to spend a small, bounded amount of time validating it.**

**Goal:** Determine whether YouTube Data API v3 comment threads on wine review videos can produce genuinely useful community-sentiment synthesis, now that Reddit access is closed off (see Phase 8's context note). This is a spike, not a committed feature — the explicit success bar is whether it adds real signal beyond what Phase 8's professional-review extraction already provides, not whether it technically works.

**Why YouTube specifically:** Of the alternatives researched 2026-07-28 (Vivino, Delectable, wine forums, X/Twitter, social-listening tools, Reddit resellers), YouTube Data API v3 was the only option that is simultaneously: an official, documented API (not scraping); genuinely self-service (create a project, enable the API, get a key — no approval queue); and free within a quota generous enough for personal volume (10,000 units/day; `commentThreads.list` costs 1 unit/call, `search.list` costs 100). Every other option researched failed at least one of those three — Vivino/Delectable explicitly prohibit scraping and have no API; wine forums have no public API; X/Twitter's affordable tier only searches the last 7 days, useless for accumulated vintage consensus; social-listening tools with Reddit coverage start at $29+/month and aren't licensed Reddit partnerships anyway; Reddit's own official paid tier requires a contract at a four-to-five-figure annual minimum.

**Scope for the PoC:**
- A small standalone script (not a shipped module) against ~10 real wines from the collection, spanning the regions actually cellared (Burgundy, Barolo, Rioja, Rhône)
- Query cascade: `{producer} {denomination} {vintage} review` → drop vintage → `{producer} {denomination} review` → drop to producer + region level → region + vintage "vintage report" as a last resort. Stop at the first tier that returns a passing match; `search.list` is the quota-expensive call (100 units vs. 1 for reading comments), so don't run every tier by default.
- Relevance verification before trusting a match — reuse the shape of `isRelevantMatch` (price module) / Phase 7's organic-result relevance filter: does the video title/description actually reference the producer and (when available) the vintage. A cheap GPT-4o classification pass on title + description + channel name is an acceptable fallback for ambiguous cases.
- Pool comments from 2–3 relevant videos per wine, not just one — a single video's comment section is reaction to one reviewer, not community sentiment
- Feed pooled comments to GPT-4o for synthesis, same extraction-boundary rule as everything else: structured output, never store or reproduce comment text verbatim beyond what's needed for the synthesis call itself
- Manual eyeball review of the output across all ~10 test wines — is the synthesis actually useful, or is it thin/generic/off-topic

**Explicitly not in scope for the PoC:** production error handling, caching, the trusted-reviewer-list integration, or any UI. If the PoC clears the usefulness bar, those become a real follow-up phase; if it doesn't, this section is the record of why it wasn't pursued further.

**`community_sentiment`/`community_excerpts` columns** (reserved since Phase 5, see schema section) are held for this phase's eventual output if it's adopted — not populated by anything currently.

**Milestone:** A clear yes/no on whether YouTube-sourced community sentiment is worth building into a real module — backed by looking at actual synthesis output against real wines from the collection, not a theoretical assessment.

---

## Phase 9 — Data review checkpoint

**Goal:** Before building the frontend, verify that the enriched wine object is returning useful, accurate output in practice across all data layers (crawled pricing, attributed scores, drinking window / vintage character / value-signal extraction, retailer links).

**Deliverables:**
- Manual review of 10–20 real wine entries enriched with crawled pricing, review extraction (scores, drinking windows, vintage character, value signal), and retailer links
- Verify the price crawl is returning results for the wines in the collection across the four configured retailers
- ~~Verify attributed critic scores are being extracted correctly from K&L and Benchmark product pages~~ — moved to Phase 7; see "Known gap" note below for why this was split out of pricing rather than fixed here
- Verify retailer search URLs resolve correctly for the four configured retailers (Phase 6.6)
- **Re-verify the four retailer search URL patterns in `backend/modules/price/retailer-search-url.ts` are still live** — render each pattern with Puppeteer (real JS execution; a static/curl fetch cannot catch a client-side-only search bug — see 2026-07-19 finding below) and confirm the DOM actually reflects the query, not just that the page returns 200. Current patterns: `shop.klwines.com/products?searchText=`, `zachys.com/search?q=`, `whwc.com/search-results/?search_query=`, `benchmarkwine.com/search?q=`. These were last verified live on 2026-07-19 (Zachys, Woodland Hills, Benchmark via direct Puppeteer render; K&L via an archived `web.archive.org` snapshot — K&L's own site blocks direct automated access, see below). The Woodland Hills Wine Co. domain (`woodlandhillswine.com`) had already gone dead and been replaced by `whwc.com` once before this check — treat retailer domain and search-param changes as an ongoing risk, not a one-time fix.
- Identify any schema gaps, data quality issues, or missing fields
- Update wine entry schema and storage adapter if required
- Document any recurring data quality issues as known limitations (e.g. wines not found by crawl)

**Additional fixes landed 2026-07-19 (verify these in this phase too):**
- Serper shopping results are now filtered for relevance (`isRelevantMatch` in `serper-query.ts`) before being accepted as a price for a wine — a listing whose title doesn't contain distinguishing words from both the producer and denomination is discarded rather than shown as a (possibly wrong) price. `fetchPriceData` now returns an explicit empty `PriceData` (non-null, `retailers: []`) rather than `null` when nothing relevant is found, and `PriceSection.tsx` renders a "No matching listings found" message for this case instead of showing a blank/dashed price row.
- Matched listings now carry `matched_vintage` (parsed from the listing title) and `vintage_mismatch` (true when it differs from the wine entry's own vintage). Both the "nearest retailer" row and each per-retailer row show a badge with the matched year whenever it's known — a neutral "confirmed" badge when it matches the wine entry's vintage, a warning badge when it doesn't. Vintage-mismatched retailers stay visible (for transparency) but are excluded from `price_min`/`price_avg`/`price_max` and from nearest-retailer selection, so a confirmed wrong-vintage price can't set the headline numbers.
- **Fixed 2026-07-19:** the K&L search URL was using the wrong query param (`search=`) — `shop.klwines.com/products?search=<query>` silently ignores it and serves the full unfiltered catalog ("10000+ Results") regardless of query. The real param is `searchText`, not `search`; `retailer-search-url.ts` and `price.test.ts` were updated accordingly.
- **Fixed 2026-07-19 (later same day):** the K&L fix above only matched Serper's `source` field when it was exactly "K&L Wine Merchants" (`.includes('k&l')`). Serper has been observed returning that merchant's name formatted differently — "K & L Wine Merchants" (spaced ampersand), "KLWines.com" (no ampersand) — and the literal substring check silently missed those, falling through to the Pass 2 fallback path instead. Both sides of the comparison are now stripped to bare alphanumerics before matching (`serper-query.ts`), so formatting drift in Serper's data can't break the match.
- **Fixed 2026-07-19 (later same day):** the "google shop empty details page" bug — a retailer link landing on a Google Shopping product page that says "Details aren't available for this product" — turned out not to be K&L-specific. Serper's `link` field is *always* a `google.com/search?ibp=oshop` product deep-link, for every merchant, with no exception; it was only ever fixed for the four preferred retailers (via `retailer-search-url.ts`'s constructed site-search URLs). Every Pass 2 fallback retailer was still using that raw broken link directly, so the same failure kept reappearing on whichever new fallback retailer Serper happened to surface next (observed live: Piggly Wiggly, Divine Cellar, Mandara Wine, Vintage Wine Merchants, Berry Bros. & Rudd). Fallback retailers now get a constructed Google *web* search URL (merchant name + wine query) instead — a page that reliably loads, generically, for any retailer, rather than a per-retailer patch.
- **Fixed 2026-07-19 (later same day):** a price could be shown for a retailer whose own live search doesn't actually return the wine (observed: a K&L price shown for Domaine Rousseau Gevrey-Chambertin 2019 that K&L's own search turns up nothing for). Root cause: the *price* attached to a retailer always comes from Serper's Google Shopping snapshot, which can be stale relative to what the retailer's site currently lists (delisted, sold out, an aged-out index entry) — nothing was checking whether the retailer's live page still backed up that price. `verify-listing.ts` now renders every retailer's constructed search URL and checks for an explicit "no results" signal in the page text (retailer-agnostic phrase matching, not per-site scraping); a retailer is dropped entirely if its own live search doesn't confirm it. A failed/timed-out render is treated as inconclusive, not evidence of delisting, so it doesn't unfairly penalize a retailer for an infra hiccup. This replaced the old GPT-4o Step 2 call, which was already a no-op for every retailer (see "Known gap," below) and just added latency/cost for a guaranteed-null result.
- **Fixed 2026-07-19 (later same day):** two listing shapes were skewing `price_min`/`price_avg`/`price_max` — a 6-pack/case listing (priced for 6+ bottles) and a non-standard bottle size like a magnum (1.5L, priced well above a standard 750ml bottle, often more than a simple 2x multiplier due to rarity premium). `pack-format.ts` parses pack quantity ("6-Pack", "Case of 6", "6 x 750ml", "dozen") and bottle size (explicit "1.5L"/"375ml", or named formats — Magnum, Half Bottle, Jeroboam, Imperial, etc.) out of the listing title. Same treatment as vintage_mismatch: flagged listings stay visible (badged — "6-pack", "1.5L") but are excluded from the aggregate price stats and nearest-retailer selection.

**Known gap carried in from Phase 6 — resolved 2026-07-19, superseded 2026-07-20:** Preferred-retailer results point Puppeteer/GPT-4o (Step 2) at a constructed *search-results* page rather than a specific product page, because Serper's returned link could never be trusted as a real product URL. The Step 2 extraction prompt explicitly returns null scores for search-results pages, so attributed critic score extraction was not working for any retailer, preferred or fallback. Of the three options this note originally raised — (a) have Puppeteer follow the top search result to a real product page, (b) accept search-results-only links and drop Step 2 entirely, (c) find another data source for scores — **(b) was chosen** for the pricing path, and the GPT-4o Step 2 call was removed from it entirely (replaced by the "no results" verification pass described above, which needed a Puppeteer render anyway). Review/critic-score sourcing moved to its own phase, **Phase 7**, where it was resolved differently than a Puppeteer-follows-search-result approach: rather than following a link discovered via the retailer's own on-site search (option (a), which also runs into K&L's bot detection on that endpoint), Phase 7 uses Serper's organic web search with a `site:`-restricted query to go straight to a real product URL, bypassing both Serper's broken Shopping links and each retailer's own search page.

**Notes:**
- This is not a build phase — it is a structured review before committing to a UI
- Any schema changes made here should be treated as migrations, not rewrites
- The goal is confidence that the data model supports the full range of UI use cases before the frontend is built

**Milestone:** Enriched wine object is validated in practice. No known schema gaps. Ready to design UI.

**Executed 2026-08-04 against a 14-wine batch. Outcome: failed — see Phase 9.1.** The review found the enriched object is not yet trustworthy enough to build a UI against. Headline finding: nine Château Lafleur critic scores (Decanter 100, Wine Advocate 99) were stored against Château Grand Village, a ~$30 wine, and only three of the batch's extractions were unambiguously the right wine *and* the right vintage. Full evidence in `docs/sessions/2026-08-04-core-functionality-defect-taxonomy.md`. Phase 10 should not start until 9.1 closes.

---

## Phase 9.1 — Wine identity matching remediation

**Goal:** Fix the root cause behind Phase 9's failed data review, so the enriched wine object can be trusted before any UI is built against it.

**Root cause:** the four dimensions of wine identity — producer, appellation, bottling, vintage — were each handled by a different mechanism in a different module, and no code path evaluated all four. The relevance check accepted any single producer word found anywhere in a page's title *or body*, never checked the vintage, and returned a boolean that could not express "right producer, right appellation, wrong vintage" — which is what most of the batch's results actually were.

Note this is the second remediation of the same symptom class. The 2026-08-02 pass correctly diagnosed logic duplication across the three modules and deduplicated it into `shared/`; that fix held and should not be redone. The defects recurred anyway, because duplication was the mechanism rather than the cause.

**Full execution spec:** `docs/specs/2026-08-04-phase-9.1-identity-matching-remediation.md` — work items, agreed decisions, acceptance criteria, and commit sequence.

**Deliverables — all code work complete 2026-08-05:**
- Graded per-dimension matcher in `shared/utils/wine-match.ts` (`scoreMatch` → `match`/`mismatch`/`unknown` per dimension) replacing the boolean `isRelevantMatch`, which is retained only as a thin wrapper. Both discovery paths migrated to score, filter and *rank* candidates — the old `.find()` took whichever result Serper ranked first, which is why a shop indexing both the 2022 and the 2020 yielded the 2020.
- Page vintage and match verdict carried onto `RetailerReview` (`page_vintage`, `vintage_gap`, `match`) and `RetailerPrice` (`vintage_verdict`). `GptPageExtraction.vintage` was already being computed and dropped on the floor; it now revises the vintage dimension of the verdict, since the rendered page is evidence where the search title is a guess. Wrong-vintage scores are kept and labelled, and excluded from `drinking_window`/`vintage_rating` derivation.
- Vintage removed from constructed retailer search URLs — `buildSearchQuery` (with vintage, to Serper) split from `buildLinkQuery` (without, to the shop's own literal search). Mirrors the Phase 7.2 decision `retailer-links/` already made. Cause of all six reported dead links.
- Diacritic folding and honorific stripping applied to query building, not just matching, plus an honorific-relaxed producer variant inserted early in the retry sequence (7 of the 14 batch wines begin with "Domaine").
- Pass 1 preferred-retailer short-circuit removed — both passes merge, deduplicated by consumed Serper item, capped at 8. Retailer discovery cross-fed between `price/` and `reviews/` via the router, in both directions.
- Honest empty states: K&L's entry gated on Serper actually having shown a K&L listing (which restored reachability of `emptyPriceData()`), three-valued `VerificationState` with a positive producer-presence signal, URL-shape guard before spending a render + GPT-4o call, fallback hygiene for already-attempted and known-unrenderable domains, `wine-searcher.com` denylisted.
- Ground-truth regression suite from the 14 wines (`backend/tests/fixtures/ground-truth-wines.ts`, run offline in CI), and `validate-reviews.ts` reporting per-stage per-retailer outcomes with the `MatchVerdict` behind every acceptance and rejection, plus vintage accuracy.
- `snapshot-enrichment.ts` + a committed "before" snapshot. Running its `diff` against the unchanged database independently reproduces the analysis from the stored JSON: 30 retailer URLs containing a vintage token, 9 critic scores on a wrong producer, 0 scores carrying a vintage verdict.

**Remaining:** purge and re-run the 14 wines against the fixed pipeline, and produce the before/after diff. Deferred pending the developer's go-ahead — it clears live data and spends real Serper/OpenAI budget.

**Test position at hand-off:** 318 backend tests (13 suites) and 40 web tests green; `tsc --noEmit` clean in both. Baseline before the phase was 249.

**Key decisions (agreed 2026-08-04, fixed):**
- Vintage **ranks and labels, never rejects** — a shop whose only page is two vintages off still yields that page
- No hard-coded vintage tolerance in the pipeline; the gap is recorded and a single display-layer constant (start at ±3) decides what renders as flagged. Vintage variation is region-dependent, so a fixed threshold is advisory, not a rule
- The deterministic matcher decides which page is worth paying to render; a model-side identity check on the rendered page is a second gate, returning *what wine the page is about* rather than a verdict

**Notes:**
- Branch `fix/wine-identity-matching`; PR open for review
- `pickSingleAgreeing`'s unanimity rule is flagged in code but deliberately unchanged — it needs a product decision. It gets *worse* as coverage improves: Mangot derived `vintage_rating` from a single critic out of 12, while any genuine two-critic difference yields null. Decide before the UI depends on `drinking_window`/`vintage_rating`.
- `RetailerPrice.vintage_mismatch` keeps its "confirmed different year" meaning and its existing role in the price stats; the new `vintage_verdict` is what makes the previously-invisible `unknown` case visible. Flipping `unknown` to count as a mismatch would have quietly excluded a lot of real listings from `price_min/avg/max`, which is a product call, not a bug fix.
- Label scan accuracy is a real upstream problem surfaced by this batch (`producer: "Montus"` for Château Montus, `denomination: "Vin de France"` for a Bordeaux Supérieur, cuvee/vineyard null on all 14) but is explicitly out of scope: the fix here is for the modules to tolerate imprecise identity, not for the scan to stop producing it

**Milestone:** No stored critic score belongs to a different producer; every score carries a vintage or an explicit unknown; the 14-wine batch re-runs clean. Phase 9's milestone can then be re-attempted.

---

## Phase 9.2 — Enrichment cost reduction (Serper budget)

**Status:** WI-1 through WI-7 landed — WI-1–6 on 2026-08-12, WI-7 (the live 14-wine
calibration re-run) on 2026-08-15, both on `service/phase-9.2-serper-cost-reduction`
(one commit per work item, per the spec's §5 sequence). See
`docs/specs/2026-08-12-phase-9.2-enrichment-cost-reduction.md` §3 for the measured
before/after figures.

**Goal:** Bring per-wine Serper spend down without narrowing retailer coverage or reopening any Phase 9.1 decision.

**Trigger:** Serper credits consuming faster than expected during Phase 9 validation, noticed 2026-08-12. Measured against current code, one wine enriched through both buttons costs **~42 credits, ~90% of it `fetch-reviews`** — not pricing, which is a single `/shopping` call.

**Root cause — structural, not a defect:** `fetchReviewData` searches every entry in `RETAILER_CONFIG`, and `findProductPageDetailed` issues up to four progressively-broader `site:`-scoped queries per retailer, retrying whenever a variant returns zero organic results — the normal outcome for the smaller shops. `RETAILER_CONFIG` went from 4 entries (`63160d4`, Phase 7) to 11 (`92c9d42`, Phase 7.3, 2026-07-29) to 12 (`9aafe88`, JJ Buckley, 2026-08-02); the per-wine query cost was never revisited across that 3× expansion. The list has not changed since 2026-08-02 — this is the cost of growth that already happened, not of a recent change. Nothing auto-fetches: both routes are already behind explicit buttons, so deferring work to a click is only available for fallback product-URL resolution (WI-6).

**Full execution spec:** `docs/specs/2026-08-12-phase-9.2-enrichment-cost-reduction.md` — work items, cost model, seed tier assignment, commit sequence, acceptance criteria.

**Deliverables:**
- **WI-1 — Serper call accounting.** `shared/utils/serper-client.ts` wrapping every outbound call, counting *attempts* (a `fetchWithRetry` retry is a billed request), attributed per wine via `AsyncLocalStorage` opened at the route. `GET /api/debug/serper-usage`. Lands first; nothing else in the phase is evaluable without a baseline.
- **WI-2 — Skip unrenderable domains in the configured review loop.** `UNRENDERABLE_DOMAINS` already exists but is consulted only by the fallback passes, so every wine still spends a full variant ladder on `klwines.com` before a render Phase 7 documented as permanently bot-blocked. Guaranteed-empty since the feature shipped. K&L stays in `RETAILER_CONFIG` — `price/` needs it for `klItemSeen` and `buildKlLinkOnlyResult`.
- **WI-3 — Tier the review retailer list.** New `reviewTier: 'primary' | 'extended'` on `RetailerConfig`. Extended retailers are searched only when the primary pass yields no critic score, reusing the existing `!results.some(r => r.critic_scores.length > 0)` predicate so all three escalation gates share one definition of "found nothing." Cost, not trust.
- **WI-4 — Freshness guard on both enrichment routes.** TTL (price 7 days, reviews 30 — different kinds of fact, not different priorities) with `?force=true` bypass, plus in-flight coalescing so a double-click cannot spend twice. UI shows "updated N days ago" with a secondary "Refresh anyway".
- **WI-5 — Per-wine negative probe memory.** Migration `004_phase9_2_probe_log.sql` adds `review_probe_log`; a retailer that returned `zero_results` for a bottling is not re-asked for `NEGATIVE_PROBE_TTL_DAYS` (start 90).
- **WI-6 — Resolve fallback product URLs on click.** Removes up to 5 `/search` calls per price fetch spent upgrading links on shops the user does not buy from; replaced by `POST /:id/resolve-retailer-url`, one credit at the moment of intent, persisted.
- **WI-7 — Calibrate tiers from the 14-wine re-run.** Per-retailer yield table in `validate-reviews.ts`, ranked on scores-per-credit.

**Key decisions (fixed 2026-08-12):**
- **No retailer is removed from `RETAILER_CONFIG`.** Coverage stays; only *when* each shop is searched changes. Shrinking the list would reintroduce the JJ Buckley failure mode from `docs/sessions/2026-08-02-review-sourcing-drift-analysis.md` — a retailer with real content producing a result indistinguishable from "we looked and found nothing."
- **Query-variant reduction (four variants → two) is deferred, not rejected.** It is the only proposed change with a known recall cost — the Woodland Hills / Fèvre miss that motivated the relaxation in the first place. Revisit only if still over budget after this phase.
- **`UNRENDERABLE_DOMAINS` and `reviewTier` stay separate mechanisms.** The first is a technical fact about whether a page can be read; the second is a product judgement about coverage versus cost. Conflating them would label a readable low-yield shop "unrenderable."
- **Negative caching applies to `zero_results` only** — never `request_failed`. Phase 9.1's central lesson was that "the search failed" and "the search ran and found nothing" are different facts; a cache that collapses them re-creates the 2026-08-05 data-loss defect with a longer fuse.
- Enrichment stays user-initiated. No auto-enrichment or background refresh is introduced here.

**Notes:**
- The seed tier assignment in the spec is drawn from the 2026-08-04 batch and is **explicitly provisional** — that evidence predates Phase 9.1, whose headline defect was scores attributed to the wrong wine, so "retailer X yielded 5 scores" may mean five scores for a different wine. WI-7 replaces it with measured numbers.
- Morrell is seeded `extended` despite demonstrably carrying attributed reviews (the Jean-Marc Vincent case); it failed on query shape, which Phase 9.1's honorific relaxation has since fixed, and has never been measured post-fix. Strong promotion candidate.
- WI-7 consumes the same 14-wine re-run already outstanding under Phase 9.1 ("purge and re-run… deferred pending the developer's go-ahead"). Run it once and take both outputs from it.
- Expected position: first enrichment of a new wine ~20–29 credits against a ~42 baseline, depending on the primary-tier hit rate; **re-enrichment of an already-enriched wine drops to ~0–5.** That second figure is invisible in per-wine math and is likely the larger real-world saving.
- Phase 10 is not blocked on this phase — 9.1's milestone is. This is budget hygiene that should land before the 14-wine re-run spends real money, not before UI work starts.

**Milestone:** Every Serper call is attributed and counted; a re-enriched wine costs approximately nothing; a wine covered by the primary tier never pays for the extended one; and no cost measure has turned a failed search into a stored "found nothing."

---

## Phase 9.3 — Discovery review UI (post-scan / add-wine decision screen)

**Status:** Spec written 2026-08-16. Not started.

**Goal:** Rebuild the one screen the developer sees in the first ten seconds after a scan
or a manual add, which hadn't been touched since Phase 6.5 and had drifted out of step
with everything Phases 7–9.2 built. Reorder it around the developer's stated priorities:
reviews first (the signal that answers "is this worth keeping"), then whether a preferred
retailer carries the wine, then a wishlist/cellar/discovered decision, then a price sanity
check.

**Trigger:** Developer review of the running app, 2026-08-16, alongside recent PR history.
Four concrete gaps, each verified against the code:
- `cellar_category` is asked for at creation (both `LabelScanFlow` and `AddWineForm`) but
  read nowhere else in the app — dead weight at exactly the wrong moment.
- Only price auto-fetches post-scan; reviews — the developer's top priority — are never
  fetched during discovery at all, only later from the wine's card.
- `+ Add Wine` has no post-save screen whatsoever — `AddWineForm`'s `onSubmit` returns
  `void` and `App.tsx` closes the form immediately, so a manually-added wine gets zero
  decision support, unlike a scanned one.
- Stale "Wine-Searcher" copy/comments remain in `LabelScanFlow.tsx`, `WineCard.tsx`, and
  `WineDetailModal.tsx` from before the Phase 6 pivot to Serper — the abandoned
  Wine-Searcher-era query the developer recalled seeing.

**Full execution spec:** `docs/specs/2026-08-16-phase-9.3-discovery-review-ui.md` — work
items, current-state findings, cost arithmetic, commit sequence, acceptance criteria.

**Deliverables:**
- `cellar_category` no longer collected at creation (schema/column left in place,
  documented as reserved — same treatment as `expert_reviews`/`community_sentiment`).
- `AddWineForm` and `LabelScanFlow` unified behind one new post-save `DiscoveryReview`
  screen, built entirely from Phase 9.2's existing enrichment plumbing
  (`useEnrichmentAction`, `fetchWineReviews`/`fetchWinePrice`, `EnrichmentFreshness`,
  `PriceSection`, `CriticScoreBadges`) — no new backend route, no new Serper call site.
- New screen order: identity → **Fetch Reviews** (click-gated, first and most prominent)
  → preferred-retailer carry-check (frontend-only summary, zero new cost) → price
  (unchanged auto-fetch) → wishlist/cellar tag decision → done.
- Label image dropped from both the pre-save and post-save screens — `label_image_url`
  was already hardcoded `null` at creation in both paths, so nothing persisted is lost.
- All "Wine-Searcher" copy and comments retired from the three files that still had them.

**Key decisions (fixed in the spec, 2026-08-16):**
- **Net new Serper calls introduced: zero.** This phase reorders and unifies existing
  enrichment actions; it does not add a call, query variant, or fallback pass.
- **Reviews stay click-gated**, even as the top-priority action — auto-firing them on
  every save would spend ~12–42 credits regardless of whether the wine is kept, and
  directly contradicts Phase 9.2's fixed decision ("Enrichment stays user-initiated. No
  auto-enrichment or background refresh.").
- **`cellar_category` is not migrated out** — stopped being asked for, not deleted.
- **No delete/discard endpoint added.** One doesn't exist today (`wines.ts` exposes
  POST/GET/PATCH only); worth its own phase if wanted, not bundled here.

**Notes:**
- Builds directly on Phase 9.2's `useEnrichmentAction`/`EnrichmentFreshness` mechanism —
  do not build a second enrichment path for the discovery screen.
- Web only; no iOS work in this phase.

**Milestone:** A wine created via either Scan Label or + Add Wine lands on the same
Discovery Review screen, sees reviews first, learns whether a preferred retailer carries
it, makes an explicit wishlist/cellar decision, and can sanity-check price — all without
adding a single new outbound Serper call.

---

## Phase 10 — UX design and prototyping

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

## Phase 11 — Frontend build

**Goal:** Build the full application UI on top of the validated data model and scan pipeline.

**Deliverables:**
- Web app in React + TypeScript: cellar management, wishlist, research, evaluate
- iOS app in Swift + SwiftUI: capture, quick log, label scan, evaluate
- Native iOS camera flow: SwiftUI camera view (AVFoundation) replaces the Phase 3 web file upload as the label scan capture surface. The backend label scan module does not change — only the input path does.
- iOS share sheet trigger: scan a bottle encountered online by sharing a photo or URL from another app
- Both frontends consuming the shared backend API
- All six hotspots implemented: Capture, Research, Evaluate, Cellar, Wishlist + Purchasing (Learn deferred to Phase 12)

**Notes:**
- Implement from Magic Patterns prototypes as visual reference — do not import prototype code
- iOS is primary surface; web parity follows
- SensorPush environment monitoring module (`backend/modules/environment/`) is included in this phase alongside the Cellar UI
- Allocation drift view (target distribution vs. actual) is included in the Cellar UI

**Milestone — GA for personal use:** App is fully functional across all core hotspots. Native iOS camera capture is live. Stable enough for daily personal use.

---

## Phase 12 — Learning features

**Goal:** Build the compounding knowledge layer. Requires sufficient data in the system to make quizzes and pattern surfaces meaningful.

**Deliverables:**
- Pattern quiz: flashcard-style, producer-to-region associations, label recognition, village tasting note characteristics, good/bad vintage years by region
- Vintage index: year-by-year quality rating per region, visible in cellar and on wine entries
- Advice archive: all captured tips searchable by category, linked to wine entries
- Live-updating wine entries: drinking windows and vintage ratings refreshed as new reviews are published

**Notes:**
- This phase requires a meaningful volume of real data in the system — do not build quizzes against an empty or sparse dataset
- The advice archive depends on conversation capture being implemented (Phase 2); verify that data exists before building the archive UI
- Vintage index's underlying data is `vintage_rating`, extracted per wine in Phase 8 (professional review vintage-character extraction) and accumulated over time — this phase aggregates what Phase 8 has already been collecting, not a new data source. Flagged 2026-07-28 as a personal-reference/edification goal — see "Open questions affecting phases."

**Milestone:** The app actively teaches rather than just stores. Pattern recognition and fluency features are live.

---

## Phase 13 — Open source release

**Goal:** Make the app generic and shareable. Abstract away hardcoded assumptions to support other users with their own API keys and preferences.

**Deliverables:**
- BYOK configuration UI for all API keys and subscription credentials (OpenAI, Serper, SensorPush, plus YouTube if Phase 8.5's PoC is adopted)
- Retailer link configuration: allow additional retailers to be added beyond the four defaults
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

- [ ] Free wine data API: no suitable free API identified for enrichment; GPT-4o label scanning (Phase 3) is the primary enrichment path. Revisit if a reliable free option emerges.
- [ ] GPT-4o Mini evaluation: test against GPT-4o for label scanning after Phase 3 is stable — potential 75% cost reduction for clean labels
- [ ] Serper Shopping coverage: verify Serper returns Shopping results for Burgundy, Barolo, and Rioja wines from the four configured retailers before closing Phase 6
- [ ] K&L NYC store coordinates: confirm whether K&L has a NYC store and update `retailers.config.ts` accordingly; fall back to San Francisco flagship if not
- [x] Puppeteer score extraction coverage: **resolved 2026-07-19 — not deferred to "check coverage," moved to Phase 7.** Confirmed structurally, not just empirically, that no retailer can return an attributed score under the current pricing-URL design (every retailer URL is a search-results page; the extraction prompt is a no-op against those by design). Scoped as its own phase, scheduled ahead of community data, rather than a Phase 6 fix.
- [x] **Serper organic search coverage for review sourcing:** validated 2026-07-24 via a live test against 21 real collection wines — Step 1 (Serper organic search + `site:` filtering) reliably found genuinely correct product pages on roughly half the wines tested, across multiple retailers per wine in several cases. Step 1 is not the bottleneck; the extraction bug diagnosed the same day (see Phase 7's keyword-windowing architecture decision) was.
- [ ] **New 2026-07-24 — `CRITIC_KEYWORDS` maintenance:** the critic/publication lookup table (`backend/modules/reviews/critic-keywords.ts`) is living data, expected to drift as critics change publications (already observed twice during research: William Kelley succeeded Joe Czerwinski as The Wine Advocate's Editor-in-Chief in April 2024; Neal Martin moved Wine Advocate → Vinous in 2022) or as the developer discovers new publications/critics worth tracking. Lower stakes than originally scoped — since the generic score-pattern anchor (see Phase 7 architecture decision) no longer gates capture on this list, a stale or missing entry just means a real publication shows up unnormalized with `known_publication: false` rather than being missed entirely. Revisit periodically; no fixed cadence yet.
- [ ] **New 2026-07-24 — keyword-window hit rate:** the 280,000-character stripped/capped fallback and the window-merging logic in `keyword-window.ts` were designed against three real captured pages (K&L, Zachys, Benchmark). Validate the generic score-pattern anchor against a broader sample of retailers during Phase 7 testing before treating the 280K cap or window sizing as settled — the project's history (K&L search param, Serper Shopping links, the 80K truncation bug itself) is that fixes validated against one or two examples tend to need a second pass once more real sites are exercised. Note (2026-07-26): Sokolin, Acker, Wine Library, and Morrell weren't in `RETAILER_CONFIG` yet at the time this was written — see Phase 6.7's status check — so "broader sample" meant Woodland Hills plus repeat testing on the existing four, not the eight-retailer set this bullet originally implied. **Update 2026-07-29:** `RETAILER_CONFIG` now has all eleven retailers (Phase 7.3) — this validation gap is now wider than originally scoped, not narrower; still open.
- [ ] **New 2026-07-26 — Puppeteer `domcontentloaded` fidelity gap:** `verify-listing.ts`'s `pageShowsNoResults` (and any similar headless-render "does this page show results" check) may be reading a stale/placeholder result count from the initial HTML shell rather than the client-side-resolved page — observed on a Zachys search URL that showed 140+ results at `domcontentloaded` but 0 once the page actually settled. Needs its own investigation (e.g. `waitUntil: 'networkidle0'`, or waiting on a specific DOM signal) — see the note in Phase 6's module structure above. **Still not fixed for `price/verify-listing.ts`.**
  - **Confirmed 2026-07-29 to also affect `reviews/puppeteer-extract.ts`'s single-*product*-page render** (a differently-shaped failure than the count-based one above): re-running the identical `domcontentloaded` render against a real product page (amsterwine.com, not in `RETAILER_CONFIG` — encountered via manual developer testing) 2 times returned a page missing a client-side-rendered description paragraph; re-running it 7 more times all included it — a genuine intermittent race between `domcontentloaded` firing and a client-side data fetch resolving, not a deterministic gap. **Partial mitigation applied in Phase 8:** `renderPageHtml` now waits a fixed `POST_LOAD_SETTLE_MS` (1.5s) after `domcontentloaded` before reading page content — 6/6 in a follow-up test with the fix applied. Deliberately not switched to `networkidle0`/`networkidle2`: validated only against one uncontrolled external site (not one of the 8 configured retailers), and the existing `domcontentloaded` choice was itself deliberate — real retailer sites with persistent analytics/chat connections can prevent network-idle from ever firing, which would turn a slow-but-working render into an outright timeout. The fixed-delay approach doesn't carry that risk. `price/verify-listing.ts`'s count-based check above is a different failure shape (stale count vs. missing content) and was not touched.
- [ ] Burgundy Report integration: ToS explicitly permits reproduction of currently available wine tasting notes for active subscribers with attribution. Evaluate as a future addition after Phase 6.6 is stable.
- [ ] Professional review BYOK (Burghound, Vinous, Wine Advocate): confirmed no API available to individual subscribers. Deferred indefinitely — revisit only if a viable individual-subscriber API becomes available.
- [x] Reddit community-sentiment layer: closed off 2026-07-28. Self-service Data API registration ended under Reddit's Responsible Builder Policy; the unofficial `.json` fallback was itself shut down 2026-05-28; the official commercial tier requires a contract at a four-to-five-figure annual minimum; third-party resellers are unlicensed scraping, inconsistent with the project's own CellarTracker/WineBerserkers principle (`CLAUDE.md` §15). Superseded by Phase 8's professional-review-extraction approach; a YouTube-based alternative is a separate, optional PoC — see Phase 8.5.
- [ ] Drinking-window reasoning/rationale text: considered for Phase 8, tabled 2026-07-28 — less cleanly fact-based than a date range, enum, or boolean; risks drifting into stored prose. Revisit only if a reliably structured (non-prose) capture method is found.
- [ ] Cumulative vintage-quality knowledge base by region: flagged 2026-07-28 as a personal-reference/edification idea — accumulate Phase 8's `vintage_rating` extractions across the collection into a region/year reference the developer can browse. Likely just Phase 12's already-planned Vintage index deliverable, once enough Phase 8 data exists — probably not a separate feature, but noted here so it isn't lost.
