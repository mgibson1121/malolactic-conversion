# CLAUDE.md — Technical Context
> Wine app project | Placeholder name: [APP_NAME] | Last updated: 2026-05-30
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
├── shared/           # Shared types, constants, validation schemas
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
- `cellar_quantity` is an integer column on the wine entry. Default 0. Do not derive it from any other field.
- `latest_tasting_note_id` (UUID, nullable) on the wine entry points to the most recent `tasting_notes` row for that wine. Updated on each note save.
- `tasting_notes` rows include `wine_id` (UUID, not null), `date` (timestamp), and all WSET fields. Multiple rows per wine are supported.
- `drinking_window_start` / `drinking_window_end` are cached/derived values — overwritten by review data, never manually set.
- `my_tags` must stay in sync with tags extracted from `tasting_notes`; GPT-4o writes back to the wine entry when a note is saved.
- The wine entry uses a Tier 1 / Tier 2 field split. Tier 1 fields are canonical and expected on every entry. Tier 2 fields (`quality_classification`, `vineyard`, `cuvee`, `grape_varieties`) are nullable. See `wine-app-product-context.md` Section 3 for full definitions before building the label scan module.

### Phase 5 — SQLite migration (current)
Schema is validated. Replace the Google Sheets adapter with SQLite. No feature behaviour changes.

- Use `better-sqlite3` (synchronous — do not introduce async database patterns)
- Schema and migrations in `backend/db/`
- Storage adapter interface (`backend/modules/storage/`) must not change — only the implementation swaps
- Google Sheets adapter retained in `backend/sheets/` but no longer in the active code path
- All Phase 1–4 tests must pass identically against SQLite before this phase is closed

### Phase 6 and beyond
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
| Shared types | TypeScript interfaces in `/shared` | Used by both backend and web |

---

## 5. Modules

Each capability is an isolated module in `backend/modules/`. Every module exposes a consistent interface and can be developed, tested, and refined independently.

| Module | Directory | Responsibility |
|---|---|---|
| Label scanning | `modules/label-scan/` | GPT-4o vision → structured wine entry fields |
| Reddit synthesis | `modules/reddit/` | Fetch Reddit posts + GPT-4o synthesis → community sentiment |
| Retailer links | `modules/retailer-links/` | Construct retailer search URLs from wine entry data; K&L, Zachys, Woodland Hills, Benchmark (Phase 6.6) |
| Price lookup | `modules/price/` | Wine-Searcher API → retailer pricing, availability, aggregate score; fallback region/grape population |
| Environment monitoring | `modules/environment/` | SensorPush Cloud API → temperature + humidity readings |
| Storage adapter | `modules/storage/` | Unified read/write interface; implementation swapped between phases |

Shared utilities:
- `shared/utils/proximity.ts` — Haversine distance calculation used to determine nearest retailer to NYC. Pure function, no side effects. Used by the price module display layer and the wine detail view.

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
- `.env.example` is committed with all required variable names and empty values — keep it up to date
- Load with `dotenv` in the backend entry point
- Claude Code must reference `.env.example` to know what keys are expected — never read `.env` directly

Required `.env` variables (`.env.example` template — all values empty):
```
OPENAI_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
WINE_SEARCHER_API_KEY=
SENSORPUSH_EMAIL=
SENSORPUSH_PASSWORD=
GOOGLE_SHEETS_CREDENTIALS=
GOOGLE_SHEETS_SPREADSHEET_ID=
```

The `GOOGLE_SHEETS_*` variables are Phase 1–4 only. They can be left empty from Phase 5 onward.

---

## 7. Label Scanning

- Model: GPT-4o vision, high detail mode
- Images must be resized to max 1024px on the longest side before the API call — enforce this in the module regardless of input source (file upload or camera)
- Output: structured JSON covering all Tier 1 and Tier 2 wine entry fields. Tier 1 fields (producer, vintage, region, denomination) are expected on every scan. Tier 2 fields (quality_classification, vineyard, cuvee, grape_varieties) are nullable — omit rather than hallucinate. `name` is not in the schema — do not include it in scan output.
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
- Use Jest for the backend and web; XCTest for iOS
- All tests must pass before merging to `main`

### GitHub Actions (CI)

From Phase 5 onward, all test runs happen in GitHub Actions — not just locally. A CI workflow file lives in `.github/workflows/ci.yml`.

The CI pipeline runs on every pull request and every push to `main`:
1. Install dependencies
2. Lint (`tsc --noEmit` + ESLint)
3. Run backend unit and integration tests (`jest`)
4. Run frontend unit tests (`jest`)
5. Build (`tsc` — confirm no type errors)

Claude Code must create or update `.github/workflows/ci.yml` when starting Phase 5. Tests that pass locally must also pass in CI before a PR is merged. Do not merge a branch while CI is red.

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
GitHub repository: https://github.com/mgibson1121/malolactic-conversion

All work is pushed to the remote. Do not leave branches local-only. Push the branch before opening a PR.

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
- `service/sqlite-migration`
- `service/reddit-module`
- `fix/wine-entry-tag-toggle`

All work happens on a branch. Merge to `main` only when CI is green.

### Pull requests
Every phase or discrete unit of work is delivered as a pull request, not a direct push to `main`. This applies from Phase 5 onward.

PR requirements:
- Title follows the same `<type>: <description>` format as commit messages (e.g. `service: sqlite migration — replace Sheets adapter`)
- Description includes: what changed, why, and any decisions made. Bullet points are fine. This is the record of intent — write it as if someone reviewing the project 6 months later needs to understand what was done and why.
- Link to the relevant phase in `docs/build-phases.md` where applicable
- All CI checks must pass before merge
- Squash merge to `main` to keep the commit history on `main` clean

Claude Code must open a PR for every phase. Do not merge the PR — leave it open for the developer to review and merge. Notify the developer in the session summary when a PR is ready.

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
- `service: implement sqlite storage adapter`
- `fix: correct tag toggle from cellar list view`
- `test: add integration tests for label scan module`
- `docs: update CLAUDE.md with phase 5 schema decisions`

Descriptions should be lowercase, present tense, and under 72 characters.

### Commit cadence
Make multiple small, focused commits rather than one large commit per phase. Each logical unit of work (schema DDL, adapter implementation, test suite, CI config) should be a separate commit. This produces a meaningful commit history and reflects the actual progression of the work.

---

## 14. GitHub Activity

This project is the primary technical portfolio signal for the developer. The GitHub activity graph, PR history, and commit log are likely to be reviewed by prospective employers.

Claude Code should help produce a professional-looking commit history by default:

- Commit frequently with meaningful messages — not in bulk at the end of a session
- Every phase produces at least one PR with a substantive description
- Avoid single-commit PRs unless the change genuinely is atomic
- `docs` commits (updating specs, CLAUDE.md, build-phases.md) are real commits — make them
- Test commits (`test: ...`) are visible in the log and signal discipline — don't batch them with feature commits

The goal is a history that shows consistent, deliberate progress — not just a series of large drops.

### Planning document commits

`CLAUDE.md`, `build-phases.md`, and `wine-app-product-context.md` are committed to the repo and treated as living documents. They are the canonical source of truth — not the copies held in Claude.ai project context.

At the end of every session, Claude Code must:
1. Check whether any of these three files differ from the versions currently in the repo
2. If they do, overwrite the repo copy with the updated version
3. Commit the change with a `docs:` commit message (e.g. `docs: update CLAUDE.md — add github activity section`)

These commits go on the current working branch, not a separate branch. Do not open a separate PR for docs-only changes — include them in the phase PR they belong to. If a planning session in Claude.ai produces updated documents with no accompanying code change, commit them directly to `main` with a `docs:` commit.

The Claude.ai project context copy may lag behind — the repo is always authoritative.

### Session summaries

At the end of every session, Claude Code must write a session summary to `docs/sessions/<YYYY-MM-DD>-<phase-or-topic>.md`. The summary must include:

- What was done (list of commits or logical changes)
- Key decisions and their rationale
- Any bugs found and fixed
- A link to the PR once opened
- What's next

Commit the session summary with a `docs:` commit on the current working branch, as the final commit before opening the PR.

---

## 15. Constraints — Read Before Building

These are hard constraints. Do not violate them without explicit instruction.

- Do not store API keys, credentials, or secrets in the database, in code, or in version control
- Do not build a hosted backend or cloud database — everything runs locally
- Do not use Postgres — use SQLite (Phase 5+) or Google Sheets (Phases 1–4, reference only)
- Do not scrape CellarTracker or WineBerserkers — both prohibit automated access in their ToS
- Do not scrape wine retailer product pages (K&L, Zachys, Woodland Hills, Benchmark, or others) — the retailer links module constructs URL strings only; it never fetches or parses retailer pages
- Do not blend or synthesise data across sources — each data source speaks in its own voice on the wine entry card
- Do not add microservice infrastructure (separate deployables, Docker Compose, service mesh) — modular code in a monorepo is sufficient
- Do not build multi-user authentication — v1 is single user
- Do not merge a PR while CI is red

---

## 16. Open Technical Questions

- [ ] Wine-Searcher API tier: start on free trial (100 calls/day) in Phase 6; confirm whether paid tier (500 calls/day, $250/month) is needed based on observed usage
- [ ] Retailer search URL patterns: verify K&L, Zachys, Woodland Hills, and Benchmark search URL structures against their live sites before building Phase 6.5 — these can change
- [ ] Burgundy Report: ToS permits note reproduction for active subscribers with attribution; evaluate as a future addition to the retailer links module after Phase 6.5 is stable
- [ ] Professional review APIs (Burghound, Vinous, Wine Advocate): confirmed no API for individual subscribers; all require enterprise/trade access. Closed unless a viable individual-subscriber path emerges.
- [ ] GPT-4o Mini: evaluate against GPT-4o for label scanning once the feature is stable
