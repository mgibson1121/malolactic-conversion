# CLAUDE.md — Technical Context
> Wine app project | Placeholder name: [APP_NAME] | Last updated: 2026-05-16
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
│   ├── sheets/       # Google Sheets adapter (Phase 1 only)
│   └── server.ts     # Entry point
├── ios/              # Swift iOS app (Xcode project)
├── web/              # React web app
├── shared/           # Shared types, constants, validation schemas
├── docs/
│   ├── product-context.md   # Product PRD — source of truth for features
│   └── specs/               # Per-feature spec files (added as features are built)
├── .env.example      # Template — never commit .env
├── .env              # Local secrets — gitignored
└── CLAUDE.md         # This file
```

---

## 3. Build Phases

### Phase 1 — Schema validation (Google Sheets backend)
The data layer is backed by Google Sheets. The goal is to validate the wine entry schema against real data before committing to a database. Wine entries, cellar state, wishlist, and tasting notes are all stored in Sheets.

- Use the Google Sheets API (v4) via the `googleapis` npm package
- One sheet per entity type (wines, cellar, wishlist, tasting_notes, advice)
- The Sheets adapter lives in `backend/sheets/` and exposes the same interface as the future SQLite adapter
- Do not build any feature that assumes SQLite during Phase 1
- The `wines` sheet must include a `tasting_note_id` column (UUID, nullable) as a foreign key to `tasting_notes`. Null = no note recorded; populated = tasting note exists.
- `drinking_window_start` and `drinking_window_end` are cached/derived values — overwritten by review data, never manually set
- `my_tags` must stay consistent with tags on the `tasting_notes` sheet; GPT-4o tag extraction writes back to the `wines` sheet when a note is saved
- The wine entry schema uses a Tier 1 / Tier 2 field split. Tier 1 fields are canonical and expected on every entry. Tier 2 fields (`quality_classification`, `vineyard`, `cuvee`, `grape_varieties`) are nullable and follow explicit extraction rules. See `wine-app-product-context.md` Section 3 for the full field definitions and extraction rules before building the label scan module.
- `name` has been removed from the schema. Wine identity is expressed as `producer` + `denomination` + `vintage`, supplemented by Tier 2 fields. Do not add a `name` column to the wines sheet.

### Phase 2 — SQLite migration (stable schema)
When the schema is stable, replace the Sheets adapter with SQLite. The module interface must not change — only the underlying storage implementation.

- Use `better-sqlite3` (synchronous, simpler than async drivers at this scale)
- Schema and migrations live in `backend/db/`
- Phase 2 begins only when the wine entry schema has been validated against real data in Phase 1

---

## 4. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Backend | Node.js + Express + TypeScript | Local API server |
| iOS | Swift + SwiftUI | Native iOS app — primary capture surface |
| Web | React + TypeScript | Management and research surface |
| Database | SQLite via `better-sqlite3` | Phase 2 only; Phase 1 uses Google Sheets |
| Sheets adapter | Google Sheets API v4 via `googleapis` | Phase 1 only |
| Shared types | TypeScript interfaces in `/shared` | Used by both backend and web |

---

## 5. Modules

Each capability is an isolated module in `backend/modules/`. Every module exposes a consistent interface and can be developed, tested, and refined independently.

| Module | Directory | Responsibility |
|---|---|---|
| Label scanning | `modules/label-scan/` | GPT-4o vision → structured wine entry fields |
| Reddit synthesis | `modules/reddit/` | Fetch Reddit posts + GPT-4o synthesis → community sentiment |
| Expert reviews | `modules/expert-reviews/` | Burghound + Vinous BYOK credential handling + data fetch |
| Price lookup | `modules/price/` | Wine-Searcher API → retailer pricing and availability |
| Environment monitoring | `modules/environment/` | SensorPush Cloud API → temperature + humidity readings |
| Storage adapter | `modules/storage/` | Unified read/write interface; implementation swapped between phases |

Rules for all modules:
- Each module has its own `index.ts`, types file, and test file
- Modules do not import from each other — they communicate via the backend router only
- Each module must degrade gracefully if its API key or credential is not configured (return null or empty state, never throw uncaught errors)

---

## 6. API Key Management

### iOS
All credentials stored in iOS Keychain. Never stored on device filesystem or transmitted to backend.

### Web + Backend
All credentials stored in a local `.env` file at the project root.

- `.env` is gitignored — never commit it
- `.env.example` is committed and kept up to date with all required variable names (values empty)
- Load with `dotenv` in the backend entry point
- Claude Code should reference `.env.example` to know what keys are expected

Required `.env` variables:
```
OPENAI_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
WINE_SEARCHER_API_KEY=
BURGHOUND_USERNAME=
BURGHOUND_PASSWORD=
VINOUS_USERNAME=
VINOUS_PASSWORD=
SENSORPUSH_EMAIL=
SENSORPUSH_PASSWORD=
GOOGLE_SHEETS_CREDENTIALS= ~/Claude_Code_Projects/Wine-Project/config
GOOGLE_SHEETS_SPREADSHEET_ID= 1oLAVCxV9M5F3Mg4WmNssvbpiD7Nxhyen_th1PlbAU-o/edit?gid=0#gid=0

---

## 7. Label Scanning

- Model: GPT-4o vision, high detail mode
- Images must be resized to max 1024px on the longest side before the API call — enforce this in the module regardless of input source (file upload or camera)
- Output: structured JSON covering all Tier 1 and Tier 2 wine entry fields. Tier 1 fields (producer, vintage, region, denomination) are expected on every scan. Tier 2 fields (quality_classification, vineyard, cuvee, grape_varieties) are nullable — omit rather than hallucinate. `name` has been removed from the schema — do not include it in scan output.
- The label scan prompt must explicitly target Tier 2 extraction rules as defined in `wine-app-product-context.md` Section 3
- **Phase 3 capture surface:** web file upload (HTML file input, image/*). The module receives an image file; resize and scan. No native camera in this phase.
- **Phase 10 capture surface:** native iOS SwiftUI camera (AVFoundation). The backend module does not change — only the input path is swapped.
- Estimated cost: ~$0.004 per scan at 1024×1024
- Future: evaluate GPT-4o Mini once the feature is stable (potential 75% cost saving for clean labels)
- Key: `OPENAI_API_KEY` from `.env` (web/backend) or iOS Keychain (iOS)

---

## 8. LLM Usage

- Model: GPT-4o for all LLM tasks (label scanning, Reddit synthesis, tasting note tag extraction)
- Do not use GPT-4 Turbo or GPT-3.5
- Key: BYOK — user supplies their own OpenAI API key
- Fallback: if no key is configured, features that require LLM degrade gracefully (e.g. raw Reddit excerpts shown instead of synthesis; label scan unavailable with clear UI message)

---

## 9. Performance Targets

- Label scan → populated wine entry card: under 30 seconds end-to-end
- This is the primary latency constraint for the iOS capture flow
- Reddit synthesis and expert review fetches can be async / background — they populate the wine entry card after the initial scan result is shown

---

## 10. Offline Behaviour

Offline mode is out of scope for v1. The app requires connectivity. No offline caching or queue is required at this stage.

---

## 11. Testing and CI

- Test-driven development is followed for all new features
- Each module has unit tests co-located in its directory (`*.test.ts`)
- Integration tests live in `backend/tests/integration/`
- Regression tests are run on every pull request before merge
- CI pipeline runs: lint → unit tests → integration tests → build
- Use Jest for the backend and web; XCTest for iOS
- A new build artifact is produced on every successful merge to `main`

---

## 12. Frontend Prototyping

UI designs are prototyped in Magic Patterns before implementation. Prototypes are used as reference only — they are not imported or used as production code. Claude Code should implement UI based on the prototype's visual design and layout, producing clean HTML/CSS/JS or SwiftUI from scratch.

---

## 13. Git Workflow

### Identity
Before making any commits, ensure git is configured with the following identity so commits appear correctly on GitHub:

```bash
git config user.name "Matt Gibson"
git config user.email "mjgibson1121@gmail.com"
```

Run these commands in the repo root if not already set. Verify with `git config --list`.

### Remote
GitHub repository: https://github.com/mgibson1121

### Branching
Branches are scoped to a feature or core technical service. Branch names follow this pattern:

```
feature/<short-description>     # New user-facing feature
service/<short-description>     # Core technical module or integration
fix/<short-description>         # Bug fix
chore/<short-description>       # Refactoring, dependency updates, config changes
```

Examples:
- `feature/label-scanning`
- `feature/cellar-view`
- `service/reddit-module`
- `service/sheets-adapter`
- `fix/wine-entry-status-lifecycle`

All work happens on a branch. Merge to `main` only when tests pass.

### Commit message conventions
Every commit message must follow this format:

```
<type>: <brief description>
```

Types:
- `feat` — new user-facing feature
- `service` — new backend module or integration
- `fix` — bug fix
- `test` — adding or updating tests
- `refactor` — code changes with no behaviour change
- `chore` — config, dependencies, tooling
- `docs` — documentation only

Examples:
- `feat: add quick-log capture flow`
- `service: implement reddit synthesis module`
- `fix: correct status transition from wishlist to cellar`
- `test: add integration tests for label scan module`

Descriptions should be lowercase, present tense, and under 72 characters.

---

## 15. Constraints — Read Before Building

These are hard constraints. Do not violate them without explicit instruction.

- Do not store API keys, credentials, or secrets in the database, in code, or in version control
- Do not build a hosted backend or cloud database — everything runs locally
- Do not use Postgres — use SQLite (Phase 2) or Google Sheets (Phase 1)
- Do not scrape CellarTracker or WineBerserkers — both prohibit automated access in their ToS
- Do not blend or synthesise data across sources — each data source speaks in its own voice on the wine entry card
- Do not add microservice infrastructure (separate deployables, Docker Compose, service mesh) — modular code in a monorepo is sufficient
- Do not build multi-user authentication — v1 is single user

---

## 16. Open Technical Questions

- [ ] Wine-Searcher API tier: confirm 500 calls/day ($250/month) before building the price module
- [ ] Burghound and Vinous: confirm credential format (API key vs. username/password) and response schema before building the expert reviews module
- [ ] GPT-4o Mini: evaluate against GPT-4o for label scanning once the feature is stable
