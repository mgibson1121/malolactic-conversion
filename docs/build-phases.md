# Build Phases
> Wine app project | Placeholder name: [APP_NAME] | Last updated: 2026-05-16
> This file defines the incremental build sequence for the project. Each phase delivers a discrete, testable increment of value. Phases should be completed in order — later phases depend on earlier ones being stable.
> Read alongside `wine-app-product-context.md` (what to build) and `CLAUDE.md` (how to build it).

---

## Phase 1 — Schema definition (Google Sheets)

**Goal:** Define and validate the wine entry schema against real data before building any UI or committing to a database. This is a data-only phase — no frontend, no external enrichment.

**Deliverables:**
- Wine entry schema defined as a Google Sheet with one tab per entity type: `wines`, `cellar`, `wishlist`, `tasting_notes`, `advice`
- Schema reflects the Tier 1 / Tier 2 field split defined in `wine-app-product-context.md` Section 3. Tier 1 fields are canonical columns present on every row. Tier 2 fields (`quality_classification`, `vineyard`, `cuvee`, `grape_varieties`) are nullable columns — empty is valid. `name` is not a column — do not add it.
- `wines` sheet includes a `tasting_note_id` column (UUID, nullable) as a foreign key to `tasting_notes`. Null = no note recorded; populated = tasting note exists.
- `drinking_window_start` / `drinking_window_end` treated as cached/derived values — overwritten by review data, never manually set
- `my_tags` kept in sync with tags on the `tasting_notes` sheet; GPT-4o tag extraction writes back to the `wines` sheet when a note is saved
- Google Sheets storage adapter in `backend/sheets/` exposing a consistent read/write interface
- Status lifecycle enforced: `discovered` → `wishlist` → `cellar` → `consumed`
- Manual entry via the backend API only — no UI at this stage

**Notes:**
- No external enrichment in this phase — all fields populated manually to validate the schema
- A free wine data API was evaluated at this stage and ruled out due to inconsistent data quality; GPT-4o label scanning (Phase 3) is the intended enrichment path
- The Sheets adapter must expose the same interface as the future SQLite adapter — no feature should assume a specific storage implementation

**Milestone:** Real wine entries exist in Google Sheets with both Tier 1 and Tier 2 fields populated from real bottles. The schema feels correct against actual data. Ready to build the POC UI.

---

## Phase 2 — End-to-end POC (skeletal web UI + Google Sheets)

**Goal:** Validate two things in a single rough pass: (1) that the wine object can be created via a minimal UI and stored correctly in the Sheets structure, and (2) that the skeletal UI structure — the core lists a wine entry belongs to — is the right shape for the product. This is a proof of concept, not a polished feature. Speed of learning matters more than code quality at this stage.

**Deliverables:**
- Manual wine entry form: create a wine object by filling in Tier 1 fields (producer, vintage, region, denomination, status, cellar category). Tier 2 fields (quality_classification, vineyard, cuvee, grape_varieties) included as optional inputs. `name` has been removed — do not include it as a form field. No scanning or enrichment — user-supplied data only.
- List view: entries displayed in a single grouped list, organised by status (`discovered`, `wishlist`, `cellar`, `consumed`)
- Core list alignment proven: a wine entry can be correctly associated with and displayed in each of the three primary lists — **Cellar**, **Wishlist**, and **Tasting Notes** — by setting its status and `tasting_note_id` field
- Status promotion: a wine can be moved forward through the lifecycle (`discovered` → `wishlist` → `cellar`) from the list view
- All reads and writes go through the Google Sheets adapter — no database yet
- Web UI only at this stage

**Notes:**
- This phase intentionally uses Google Sheets as the backend so schema changes remain cheap — a new column is a one-line addition, not a migration
- The UI is skeletal on purpose: layout and navigation structure are what's being validated, not visual design or interaction polish
- No external data fetching in this phase; all fields are user-supplied
- If the list structure or wine object shape feels wrong against real data, fix it here before moving to SQLite — that is the explicit purpose of this phase

**Milestone:** A wine entry can be created manually, stored in Google Sheets, and correctly displayed across the Cellar, Wishlist, and Tasting Notes list views. The schema and skeletal UI structure are validated and ready for the SQLite migration.

---

## Phase 3 — Label scanning

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

## Phase 4 — Evaluate (WSET tasting notes)

**Goal:** Record a structured tasting note when consuming a wine. Complete the wine entry object with user-generated evaluation data.

**Deliverables:**
- WSET structured tasting note form with pre-populated options: appearance, nose, palate, conclusions
- Free text notes field
- Voice note upload and transcription via GPT-4o
- Tag extraction from completed notes via GPT-4o
- Review linked automatically to the wine entry
- `my_rating` field: `pass` / `ok` / `good` / `great`
- Tags surfaced on the wine entry card

**Notes:**
- WSET framework is fixed in v1 — do not make it configurable yet
- Tag extraction requires the OpenAI key; if not configured, free text is saved without tags

**Milestone:** Opening a bottle produces a structured, tagged tasting note linked to the wine entry. The wine object is now complete for all list use cases.

---

## Phase 5 — SQLite migration

**Goal:** Schema is validated against real data. Replace the Google Sheets adapter with SQLite. No feature behaviour changes.

**Deliverables:**
- SQLite schema and migrations in `backend/db/`
- `better-sqlite3` replacing the Sheets adapter in `backend/modules/storage/`
- All Phase 1–4 features verified working identically against SQLite
- Google Sheets adapter retained in `backend/sheets/` but no longer active

**Notes:**
- The storage adapter interface must not change — only the implementation swaps
- This phase begins only when the wine entry schema has been stable across Phases 1–4
- `better-sqlite3` is synchronous — do not introduce async database patterns

**Milestone:** App runs entirely locally with no dependency on Google Sheets.

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
- Confirm Burghound and Vinous credential format (API key vs. username/password) and response schema before building — see open questions in `CLAUDE.md`
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
