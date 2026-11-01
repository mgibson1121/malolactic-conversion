# Phase 13 — Production deployment and distribution

> v2 — 2026-11-01. Status: **approved by the developer 2026-11-01; in progress — WI-1, WI-2 and WI-3 built 2026-11-01 (see `docs/build-phases.md`); WI-3 was built ahead of WI-5 by developer decision so the staging app is never open; WI-5 next.** v1 (2026-10-10) was written in a Claude.ai planning session after the developer's usage context and six clarifying answers.
> Read alongside `CLAUDE.md`, `docs/build-phases.md` (Phases 12, 12.1, 12.2), and the two Phase 12 specs.
> **Numbering (resolved 2026-11-01):** this is Phase 13. The former Phase 13 (remaining frontend surfaces), 14 (learning) and 15 (open source) are now 14, 15 and 16 in `docs/build-phases.md`. The "call it Phase 12.3" alternative is moot: 12.3–12.5 are the 2026-10-31 field-test round 2.

---

## 1. Goal

Move the app from "backend on the developer's laptop, phone on the same LAN" to a deployment the developer and his wife use daily from anywhere (Wi-Fi or cellular), with updates that arrive like App Store updates and a single command (or merge) to ship them.

**Usage context (developer, 2026-10-10):** mostly the iPhone app (about 5 sessions for every 1 web session); two users for the foreseeable future; about 5 bottles scanned per session, a few sessions a week; data is a wine collection (not sensitive); the real exposure is the paid OpenAI and Serper keys behind the backend.

## 2. Decisions fixed 2026-10-10

| # | Decision | Reasoning |
|---|---|---|
| D1 | Both users on iPhone. **One shared cellar**; no per-person ratings or notes. | Native SwiftUI app is iOS-only. Per-person attribution would be a schema change and is out of scope. |
| D2 | **Cloud container on Fly.io** (Ashburn, nearest NYC). Fallback if WI-5 fails: Google Cloud Run + Litestream, or a home machine behind a Cloudflare Tunnel. | Chromium needs a real container; SQLite needs a persistent disk. Plain serverless functions are ruled out (ephemeral filesystem; Postgres is forbidden by CLAUDE.md §15). |
| D3 | **One container serves the API and the built web app.** Default `*.fly.dev` HTTPS hostname; **no custom domain now** (can be added later without rework). The developer's laptop may still run the web app locally against the cloud backend. | Same origin, one deploy, no domain cost. |
| D4 | **SQLite on a Fly volume, exactly one machine.** | SQLite is single-writer. No multi-instance. |
| D5 | **Idle auto-stop** (scale to zero). Start at 1 GB RAM; right-size from WI-5 measurements. Fallback: always-on (about $6.69/mo). | Usage is minutes per week. |
| D6 | **iPhone distribution: TestFlight** (paid Apple Developer Program, $99/yr), **internal testers**. Builds by **Xcode Cloud** (25 compute hours/month included). Wife joins by Apple ID invite. | Only option that is automatable, updates through an app, and avoids per-release App Review. Rejected: free personal-team installs (7-day expiry), ad hoc (manual device IDs, no update prompts), App Store unlisted (review on every release), PWA (discards the native app). |
| D7 | **Two TestFlight groups:** *Developer* receives every build automatically; *Household* receives builds the developer promotes. | A broken build never reaches the wife's phone untested. |
| D8 | **Release rule:** backend auto-deploys on merge to `main` once CI is green. iOS builds on every merge that touches `ios/**`. Promotion to Household is a git tag (`ios-v*`) or one click. | Developer asked for push-and-consume. |
| D9 | **Security:** HTTPS only; per-device bearer token (held in iOS Keychain); rate limits on metered routes; OpenAI monthly spend cap; no accounts or passwords. | Interception on Wi-Fi/cellular is solved by TLS (iOS enforces it). The real risk is someone spending the API keys. Serper is prepaid, so its exposure is capped. VPN-only (Tailscale) rejected as disproportionate for two users and non-sensitive data. |

## 3. Constraints this phase amends (record at the original claim too)

- **CLAUDE.md §15 "Do not build a hosted backend or cloud database"** — reversed for the backend and its SQLite file. Still no Postgres, no separate cloud database service. (Phase 12 D5 already flagged this.)
- **CLAUDE.md §15 "Do not build multi-user authentication"** — stands. A device token identifies a device, not a person; there are no accounts, roles, or per-person data.
- **CLAUDE.md §6 key custody** — `OPENAI_API_KEY` and `SERPER_API_KEY` move from `.env` to Fly secrets. The iOS Keychain holds only the device token, never the API keys. `.env` stays for local development.
- **Phase 12 D5 "LAN-only"** — superseded for the Release build. Debug builds keep LAN/localhost.
- **§2 repo structure** gains `Dockerfile`, `fly.toml`, `docs/ops/runbook.md`.

## 4. Cost (verified 2026-10-10 unless noted)

| Item | Cost |
|---|---|
| Apple Developer Program | $99/yr (about $8.25/mo) |
| Fly machine, 1 GB (derived: $2.19 for 256 MB + $6/GB) | about $6.69/mo **only while running**; with idle stop, expected cents per month |
| Fly machine, 2 GB (derived) | about $12.69/mo while running |
| Fly volume (3 GB provisioned) | about $0.45/mo |
| Snapshots (first 10 GB free), R2 backup (10 GB free), Xcode Cloud (25 h free), TestFlight, existing GitHub Actions | $0 |
| Egress | $0.02/GB, negligible |
| Custom domain | $0 now; about $10–15/yr later (estimate) |

**Expected all-in: about $9–10/mo with idle stop; about $15/mo always-on at 1 GB; about $21/mo always-on at 2 GB.** Apple's $99 is the only up-front cash. Serper pack and OpenAI usage are existing costs; the wife's scans add a small usage-based amount.

## 5. Risks

- **R1 Retailer yield from a datacenter IP.** Retailers may block cloud IPs harder than a home connection (K&L already blocks home). Gate: WI-5.
- **R2 Chromium memory.** Peak is set by render concurrency, not by volume. Measured in WI-5.
- **R3 Cold start.** First request after idle waits for wake-up. Mitigations: compile TypeScript ahead of time (currently `ts-node`), launch Chromium lazily, the app's launch-time list fetch wakes the server early. Measured in WI-5.
- **R4 TestFlight 90-day build expiry.** Builds on merge cover active development; add a scheduled or monthly build so a quiet quarter does not brick both phones.
- **R5 Version skew.** The backend deploys in minutes; phones lag. See WI-8.
- **R6 Migrations on real data.** Phase 12 had a migration re-run bug that turned drafts into saved wines. Prod migrations need a pre-migration backup and a rollback path.
- **R7 SQLite WAL.** The local `wine.db` has a large write-ahead log; copying only the `.db` file would lose data. Use `sqlite3 .backup` (or checkpoint first) for the one-time upload.
- **R8 Public repo.** No secret, token, or signing material is ever committed. Secrets live in Fly, GitHub Actions secrets, and Apple's stores.

## 6. Work items

**Sequence:** WI-0 → WI-1, WI-2 → **WI-5 (gate)** → WI-3, WI-4 → WI-6 → WI-7, WI-8, WI-9 → WI-10 → WI-11.

**WI-0 — Prerequisites (developer; start now, Apple enrollment can take days).** Enroll in the Apple Developer Program. Create a Fly.io account. Get the wife's Apple ID for the TestFlight invite. Set a monthly usage cap on the OpenAI account.

**WI-0 status (2026-11-01):** Apple Developer Program is active (Individual; Team ID `8PZC3RCML7`, the team the iOS project already signs with; renews 2027-10-31; auto-renew is currently off — turn it on or set a reminder, or TestFlight distribution stops). Xcode shows the paid team. Fly.io account created (confirm a payment card is on file). OpenAI monthly spend cap: skipped by developer decision — WI-3's per-device tokens and rate limits are the main control. **Still to do:** create the App Store Connect app record (bundle ID `com.mgibson.WineApp`, Full Access) and add the wife as an App Store Connect user — both before WI-9; Cloudflare R2 account, bucket and scoped API token — before WI-4; `FLY_API_TOKEN` as a GitHub Actions secret — before WI-6; authorize Xcode Cloud's access to the GitHub repo (a UI step) — at WI-9.

**WI-1 — Backend production readiness.** Build step compiling TypeScript to JavaScript and run with `node` (no `ts-node` in production). Bind `0.0.0.0` and read `PORT`/DB path from env. `GET /healthz` (unauthenticated, no DB write). CORS allowlist from env instead of the hard-coded `localhost:5173`. Express serves the built `web/` bundle. Chromium launched lazily with container-safe flags; render concurrency capped by config. Graceful shutdown on SIGTERM: finish in-flight work, checkpoint the WAL, close the DB. Trust the proxy headers.

**WI-2 — Container and Fly configuration.** `Dockerfile` (Node plus Chromium), `fly.toml` (Ashburn, volume mount, one machine, auto-stop/auto-start, minimum machines 0), Fly secrets for the API keys and tokens. Verify the idle-stop behaviour with a volume attached (not yet confirmed). Confirm the draft sweep (runs on start and every 24 h) still behaves under auto-stop.

**WI-3 — Authentication and abuse protection.** Bearer-token middleware (constant-time compare) on every route except `/healthz`. Tokens held as a Fly secret list so each device's token can be revoked independently; issue two (developer, wife) plus one for the web app. Rate limit on the metered routes (`fetch-price`, `fetch-reviews`, `label-scan`, `confirm-retailer-link`, `resolve-retailer-url`). Tests: missing, wrong, and revoked token; `/healthz` stays open. Web app reads its token from local config, never from the bundle.

**WI-3 as built (2026-11-01), differences from the text above:** (1) built **before** WI-5 by developer decision, so the staging app is never unauthenticated; a production start without `DEVICE_TOKENS` refuses to run. (2) `POST /api/tasting-notes` is also rate-limited — it calls GPT for tag extraction. (3) "Every route except `/healthz`" is every `/api` route: the static web bundle stays public, since it holds no secret and a browser must load it to ask for the key. (4) The web app's "local config" is either the browser's `localStorage` (typed once into a prompt) or, for Vite against the cloud, `WINE_ACCESS_KEY` in `.env` added by the dev proxy. Limits: 60/hour, 200/day per device, in memory.

**WI-4 — Data safety and migration.** Automatic backup before any schema migration. Nightly off-box backup to Cloudflare R2 (Litestream or a scheduled `.backup`). One-time upload of the local database using `sqlite3 .backup`; verify row counts for wines, tasting notes and settings against the local copy before cutover. Restore drill documented and performed once. Local `wine.db` kept until the developer signs off.

**WI-5 — Deployment test (go/no-go gate).** Deploy the container to a staging Fly app. Replay the 14-wine ground-truth set from the cloud and compare against the stored laptop baseline (`validate-reviews-results.json`). Record per-retailer yield, peak memory per scan, and cold-start time. **Pass rule (confirmed by the developer 2026-11-01; no numeric cold-start threshold is fixed — the developer judges it from the measured figure):** the cloud finds a trusted-critic score on at least as many of the 14 wines as the baseline minus one; peak memory fits the chosen size; cold start is acceptable to the developer. **Metered-call arithmetic (CLAUDE.md §15):** about 20–29 Serper credits per wine at first enrichment (Phase 9.2) × 14 wines is roughly 280–410 credits, about $0.40 at $50 per 50,000 credits, plus a small GPT-4o amount. One time; no new metered call is added to the product. **If it fails:** run the same container on a home machine behind a Cloudflare Tunnel, or revisit the host; the remaining work items are unchanged.

**WI-6 — Backend CI/CD.** GitHub Actions job: after CI is green on `main`, `flyctl deploy` using a `FLY_API_TOKEN` secret; post-deploy smoke test against `/healthz` and one authenticated read. Rollback documented as redeploying the previous release. Existing CI jobs unchanged.

**WI-7 — iOS production configuration.** Separate Debug and Release configurations: Debug keeps the LAN/localhost server and the local-network exception; Release has the production HTTPS URL built in and no cleartext exceptions. Keychain storage and an "Access key" field in the existing server-settings screen for the device token (entered once; the wife receives hers privately, never through the repo). Remove the "type your server address" step from the Release flow.

**WI-8 — Version compatibility.** The app sends its build number on every request. The backend answers `426` with the minimum supported build when the app is too old, and the app shows "Update available in TestFlight". Policy: API changes are additive until the minimum build is raised deliberately. Note: a change to `shared/types.ts` still regenerates the iOS fixtures in the same PR.

**WI-9 — Xcode Cloud and TestFlight.** Workflow A: on merge to `main` touching `ios/**`, archive and distribute to the Developer group automatically. Workflow B: on tag `ios-v*`, distribute to the Household group. A scheduled or monthly build to keep builds inside the 90-day window (confirm Xcode Cloud supports a scheduled start condition; otherwise a monthly tag). Existing GitHub Actions iOS job stays as the PR check. Fallback if Xcode Cloud proves awkward: GitHub Actions plus fastlane.

**WI-10 — Household onboarding.** Wife's iPhone: install TestFlight, accept invite, install the app, enter her access key. Short written checklist in the runbook. Verify a scan end to end on her phone over cellular.

**WI-11 — Documentation.** Apply §3's amendments to CLAUDE.md at the original claims. Add a "Phase 13" entry to `docs/build-phases.md`. Create `docs/ops/runbook.md` (deploy, rollback, backup and restore, rotate or revoke a token, add a tester, what to do when a build expires). Documentation delta on the PR per CLAUDE.md §13.

## 7. Rules carried forward

Metered enrichment stays user-initiated; no new automatic call is introduced. Additive tags, `promoted_at` drafts, never blending sources, and every other schema invariant are untouched. Each migration file runs once. No secrets in version control.

## 8. Out of scope

Custom domain; separate staging environment beyond WI-5's test app; push notifications; per-person ratings or notes; Android; public App Store release; the iOS share extension; Cloud Run (kept only as a fallback).

## 9. Open items before building

1. ~~Phase number~~ — resolved 2026-11-01: Phase 13; the former 13–15 are now 14–16.
2. ~~Confirm WI-5's pass rule~~ — confirmed 2026-11-01 (see WI-5).
3. Confirm idle-stop works with a volume attached and the draft sweep (WI-2).
4. Confirm internal TestFlight testers skip Beta App Review as expected (first build).

## 10. Acceptance criteria

1. Both phones run the app over cellular and Wi-Fi against the cloud backend, with no laptop involved.
2. A merge to `main` deploys the backend with no manual step; a bad deploy is reversed by redeploying the previous release.
3. A merge touching `ios/**` reaches the developer's phone through TestFlight; a tagged build reaches the wife's phone.
4. A request without a valid token is rejected; revoking one device's token leaves the other working.
5. A restore from backup has been performed once and the data matched.
6. The WI-5 numbers (yield, memory, cold start) are recorded in `build-phases.md`, and the chosen machine size comes from them.
7. Monthly cost has been observed for one billing period and compared with section 4.

**Milestone:** The developer and his wife use the app daily from anywhere; shipping an enhancement is a merge, and consuming it is a TestFlight update.
