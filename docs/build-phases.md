# Build Phases
> Wine app project | Placeholder name: [APP_NAME] | Last updated: 2026-07-19
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
- Pass 1: filter results for configured preferred retailers (K&L, Zachys, Woodland Hills, Benchmark)
- Pass 2 (fallback): if Pass 1 returns no matches, use the unfiltered Serper results — any wine retailer Google found. Flag these as "other retailers" in the stored data.
- From matching results, extract per retailer: name, price, product URL
- Compute `price_min`, `price_avg`, `price_max` across all matching results
- Identify nearest retailer to NYC using Haversine distance from static retailer coordinate lookup
- Store all results as a point-in-time snapshot

**Step 2 — Puppeteer score extraction (attributed critic scores)**
- For each product URL returned in Step 1, Puppeteer opens the URL in headless Chromium
- Waits for the page to fully render (product data visible in DOM)
- Passes rendered HTML to GPT-4o with a structured extraction prompt
- GPT-4o extracts: any critic scores visibly attributed to a named publication (score value + publication name). Never infer or hallucinate attributions. Never extract tasting note text.
- Results stored per retailer in `price_retailers` JSON alongside price and URL
- Runs async — does not block Step 1 results from displaying
- Each retailer page is independent — if one fails, the others continue

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

**Schema additions (migration on top of Phase 5 — do not alter existing columns):**
- `price_min` REAL — nullable
- `price_avg` REAL — nullable
- `price_max` REAL — nullable
- `price_fetched_at` TEXT — ISO timestamp of last run
- `price_retailers` TEXT — JSON array: `{ slug, name, price, url, is_preferred_retailer: boolean, critic_scores: [{ publication, score }] }`
- `nearest_retailer` TEXT — JSON object: `{ slug, name, price, url, distance_miles }`

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
├── gpt-extract.ts         # GPT-4o score extraction from rendered HTML
├── retailers.config.ts    # Extensible retailer list with coordinates
├── PROMPT.md              # GPT-4o extraction prompt documentation
├── types.ts               # TypeScript types
└── price.test.ts          # Unit tests (mocked Serper responses + HTML fixtures)
```

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
3. Inspect the wine entry: `sqlite3 backend/db/wine.db "SELECT price_min, price_avg, price_max, price_fetched_at, nearest_retailer, price_retailers FROM wines ORDER BY date_added DESC LIMIT 1;"`
4. Entry shows non-null values for all price fields

~~5. At least one retailer in `price_retailers` has a non-empty `critic_scores` array~~ — **dropped 2026-07-19.** Attributed critic-score extraction requires rendering an actual single-product page; every retailer URL this module produces (preferred and fallback alike) is a constructed search-results page, and always will be, since Serper never returns a trustworthy product URL to build one from. Score sourcing is real work — locating the correct product link within a rendered search page, then rendering that page too — and is deferred to Phase 6.7, not folded into pricing. See the Phase 8 "Known gap" note and Phase 6.7 below for the decision record.

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

Contents when populated:
- **Critic scores** — attributed scores extracted from rendered retailer pages (e.g. "Burghound: 92"). Each displayed with publication name. Omit if none found.
- **Average price** — `price_avg` formatted as currency. Omit if null.
- **Nearest retailer** — single row: name, price, tappable link. Nearest to NYC using Haversine distance from retailer config. Omit if no results.

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
| Avg price | `price_avg` | Labelled "Avg price (crawled retailers)". Omit if null. |
| Critic scores | `price_retailers` | Any attributed scores extracted from retailer pages (e.g. "Burghound: 92"). Each score shown with publication name. Omit row if none found. |
| Nearest retailer | `nearest_retailer` | Single closest retailer to NYC — name, price, tappable link. Omit if null. |

**Layout and behaviour rules:**
- Null Tier 2 fields are hidden entirely — no empty rows, no placeholder dashes. The view collapses around what exists.
- Status badges sit together on one row.
- All links open in the default browser — no in-app webview.
- No edit controls, no Evaluate CTA. This is a reference view only.
- Visually more compact than the Add Wine form — tight label/value pairs, not input chrome.
- Back navigation returns to the originating list.

---

**Shared utility:**
- Haversine distance calculation (nearest retailer to NYC) is implemented as a pure function in `shared/utils/proximity.ts`. Retailer coordinates come from `backend/modules/price/retailers.config.ts` defined in Phase 6.

**Schema additions (on top of Phase 6):**
- No new columns required — all fields used in this phase (`price_avg`, `price_retailers`, `nearest_retailer`, `retailer_links`) are defined in Phase 6 and Phase 6.6 respectively.

**Milestone:** Post-scan screen shows wine info and crawled pricing in separate tabs. Tapping any wine entry from any list opens the compact detail view showing attributed critic scores, avg price, and nearest retailer.

---

## Phase 6.6 — Retailer review links

**Goal:** Surface pre-constructed deep-link searches to trusted fine wine retailers directly from the wine entry card. Enables fast access to professional reviews and tasting notes published on retailer product pages without any scraping or API dependency.

**Context:** Research confirmed that no professional wine publication (Burghound, Vinous, Wine Advocate) offers API access to individual subscribers. The only programmatic access routes require enterprise-level trade memberships costing thousands per year. The retailer deep-link approach achieves the same practical outcome — fast access to trusted reviews — without any ToS exposure. The app constructs the search URL from structured wine entry data; the user taps to open it in their browser.

**Deliverables:**
- Link generator module in `backend/modules/retailer-links/`
- Takes `producer`, `denomination`, `vintage` from the wine entry and constructs retailer-specific search URLs for each configured retailer
- Four retailers configured in v1:
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

## Phase 6.7 — Review & critic score sourcing (deferred, not yet scheduled)

**Goal:** Extract attributed critic scores (e.g. "Burghound: 92") from retailer product pages — the capability Phase 6 originally described as part of its Step 2, now split out as its own phase.

**Why this was split out (decided 2026-07-19):** Pricing and review-sourcing turned out to be substantially different problems wearing the same "retailer" label. Pricing only needs a page that reliably loads and shows the right listing — a search-results page is fine, and after the 2026-07-19 pricing fixes, every retailer URL this module produces (preferred and fallback) is deliberately a search-results page, verified live before its price is trusted (see `verify-listing.ts`). Review sourcing needs something search-results pages structurally cannot provide: the specific single-product page, because that's where an attributed score actually lives in the DOM. Serper never returns a trustworthy product URL to start from (its `link` field is always a `google.com/search?ibp=oshop` aggregator link, confirmed empirically — see the Phase 8 notes below), so this was never actually working, before or after today's fixes — today just made that explicit instead of accidental (the GPT-4o extraction step that used to run per-retailer was removed entirely, since it was guaranteed-null against a search-results page).

Also worth being explicit: the four retailers in `retailers.config.ts` (K&L, Zachys, Woodland Hills, Benchmark) were chosen because they're known to carry Burghound/Vinous scores on their listings — that was about review sourcing, not about pricing coverage. Pricing already casts a wider net independently via the Pass 2 fallback (any relevant retailer Serper returns, capped at 5, used whenever none of the four preferred retailers have pricing) and doesn't need or benefit from the four-retailer list being expanded. When a preferred retailer happens to supply both a price and, eventually, a review, that should be treated as incidental — not something the architecture assumes or is designed around.

**Scope, when this phase is picked up:**
- Given a retailer's search-results page, locate the link to the correct single product (matching producer/denomination/vintage — reuse `isRelevantMatch`-style logic against the results page's own listing text)
- Render that specific product page with Puppeteer
- Run GPT-4o extraction (`gpt-extract.ts` already has the right prompt shape for this) against the rendered product page, not the search page
- Store results back onto the wine entry, kept visually and structurally separate from the price section — not blended into `PriceSection.tsx`

**Notes:**
- Not scheduled against a specific point in the phase sequence yet — deferred until pricing is fully settled and validated (Phase 8)
- `gpt-extract.ts` and its prompt already exist and don't need to change — only the URL fed into it does
- This is the natural home for the professional-review BYOK question (Burghound, Vinous, Wine Advocate) if a viable individual-subscriber path ever emerges — see "Open questions affecting phases"

**Milestone:** Not yet defined — to be scoped when this phase is picked up.

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
- Synthesis and price fetches are async / background — they populate the wine entry card after the initial scan result is shown
- Raw excerpts must always be available as a fallback — the community layer never disappears entirely

**Milestone:** Scanning a bottle returns community opinion alongside crawled pricing and attributed critic scores.

---

## Phase 8 — Data review checkpoint

**Goal:** Before building the frontend, verify that the enriched wine object is returning useful, accurate output in practice across all data layers (crawled pricing, attributed scores, community sentiment, retailer links).

**Deliverables:**
- Manual review of 10–20 real wine entries enriched with crawled pricing, community data, and retailer links
- Verify the price crawl is returning results for the wines in the collection across the four configured retailers
- ~~Verify attributed critic scores are being extracted correctly from K&L and Benchmark product pages~~ — moved to Phase 6.7 (deferred); see "Known gap" note below for why this was split out of pricing rather than fixed here
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

**Known gap carried in from Phase 6 — resolved 2026-07-19:** Preferred-retailer results point Puppeteer/GPT-4o (Step 2) at a constructed *search-results* page rather than a specific product page, because Serper's returned link could never be trusted as a real product URL. The Step 2 extraction prompt explicitly returns null scores for search-results pages, so attributed critic score extraction was not working for any retailer, preferred or fallback. Of the three options this note originally raised — (a) have Puppeteer follow the top search result to a real product page, (b) accept search-results-only links and drop Step 2 entirely, (c) find another data source for scores — **(b) was chosen**, and the GPT-4o Step 2 call has been removed from the pricing path entirely (replaced by the "no results" verification pass described above, which needed a Puppeteer render anyway). Review/critic-score sourcing (option (a), effectively) is **not abandoned** — it's moved out to its own phase, **Phase 6.7**, on the reasoning that pricing and review-sourcing are different problems with different retailer-URL requirements (a search-results page is sufficient for pricing; a single product page is required for a score) and shouldn't be built as one combined concern.

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
- BYOK configuration UI for all API keys and subscription credentials (OpenAI, Reddit, SensorPush)
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
- [x] Puppeteer score extraction coverage: **resolved 2026-07-19 — not deferred to "check coverage," moved to Phase 6.7.** Confirmed structurally, not just empirically, that no retailer can return an attributed score under the current pricing-URL design (every retailer URL is a search-results page; the extraction prompt is a no-op against those by design). Scoped as its own phase rather than a Phase 6 fix.
- [ ] Burgundy Report integration: ToS explicitly permits reproduction of currently available wine tasting notes for active subscribers with attribution. Evaluate as a future addition after Phase 6.6 is stable.
- [ ] Professional review BYOK (Burghound, Vinous, Wine Advocate): confirmed no API available to individual subscribers. Deferred indefinitely — revisit only if a viable individual-subscriber API becomes available.
