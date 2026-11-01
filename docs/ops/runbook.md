# Operations runbook

> Phase 13 (spec: `docs/specs/2026-10-10-phase-13-production-deployment.md`). Started 2026-11-01 with WI-1/WI-2; sections marked *(WI-n)* are filled in as that work item is built. WI-11 completes this file.

The production backend is one Fly.io machine (`fly.toml`, region `iad`) running the root `Dockerfile`: the compiled API plus the built web app, with SQLite at `/data/wine.db` on the volume `wine_data`. API keys are Fly secrets, never in the repo or the image.

## One-time setup

```bash
brew install flyctl
fly auth login
```

## WI-5 — staging deployment test (go/no-go gate)

A throwaway app proves the container works from a datacenter before anything real moves. It uses a fresh, empty database, so the collection is never touched.

> **Exposure while it runs.** Until WI-3 adds device tokens, a deployed app answers anyone who finds its `*.fly.dev` URL, and the metered routes spend the OpenAI and Serper keys. Keep the staging app up only for the test, then destroy it (last step). Alternatively, build WI-3's token middleware before this gate.

1. Create the app and its volume (Fly app names are global; pick any free name):
   ```bash
   fly apps create wine-staging-<suffix>
   fly volumes create wine_data --app wine-staging-<suffix> --region iad --size 3 --yes
   ```
2. Copy only the two keys from `.env` into Fly secrets (nothing is printed):
   ```bash
   grep -E '^(OPENAI_API_KEY|SERPER_API_KEY)=' .env | fly secrets import --app wine-staging-<suffix>
   ```
3. Deploy. `--ha=false` keeps it to one machine, because SQLite is single-writer (spec D4):
   ```bash
   fly deploy --app wine-staging-<suffix> --ha=false
   ```
   The first build runs on Fly's remote builder; this is also the first time the `Dockerfile` is built at all.
4. Smoke test:
   ```bash
   curl -s https://wine-staging-<suffix>.fly.dev/healthz
   curl -s https://wine-staging-<suffix>.fly.dev/api/wines
   ```
5. **Idle stop with the volume attached** (spec open item 3). Leave it idle for a few minutes, then check that `fly machine list --app wine-staging-<suffix>` shows the machine `stopped`. Its logs should show the drain (`SIGTERM: no new connections…`) and no error.
6. **Cold start.** With the machine stopped:
   ```bash
   time curl -s https://wine-staging-<suffix>.fly.dev/healthz
   ```
   Record the time. The developer judges whether it is acceptable; no threshold is fixed.
7. **Retailer yield and memory.** An SSH session is not HTTP traffic, so idle stop could stop the machine mid-run. Switch it off for the run (`<id>` from `fly machine list`; confirm the flag with `fly machine update --help` if it differs). Keep a copy of the laptop baseline first, because the script overwrites its output file:
   ```bash
   fly machine update <id> --autostop=off --app wine-staging-<suffix> --yes
   cp validate-reviews-results.json "Claude outputs/validate-reviews-baseline-laptop.json"
   fly ssh console --app wine-staging-<suffix> -C "node backend/dist/backend/scripts/validate-reviews.js"
   fly ssh sftp get /app/backend/dist/validate-reviews-results.json "Claude outputs/validate-reviews-results-fly.json" --app wine-staging-<suffix>
   ```
   The script runs inside the machine, so it renders under the same `RENDER_CONCURRENCY` as production. It costs roughly 280–410 Serper credits (about $0.40) plus a little GPT-4o, once (spec WI-5). While it runs, watch memory on the app's **Metrics** tab in the Fly dashboard and look for `Out of memory` in `fly logs`.
   **Pass rule:** the cloud run finds a trusted-critic score on at least as many of the 14 wines as the laptop baseline minus one. Peak memory must fit the machine size. Record yield per retailer, peak memory and cold start in `docs/build-phases.md`.
8. Destroy the staging app (this deletes its volume too):
   ```bash
   fly apps destroy wine-staging-<suffix> --yes
   ```

If the gate fails, the spec's fallback is the same container on a home machine behind a Cloudflare Tunnel.

## Tuning

- `RENDER_CONCURRENCY` (`fly.toml`, `[env]`) caps concurrent Chromium renders across price and reviews. Lower it if a scan runs out of memory; raise it, or the machine size (`[[vm]] memory`), only on WI-5 evidence.
- `SHUTDOWN_GRACE_MS` must stay below `kill_timeout`.

## Deploy and rollback *(WI-6)*

## Backup and restore *(WI-4)*

## Device tokens: issue, rotate, revoke *(WI-3)*

## TestFlight: add a tester, promote a build, expired builds *(WI-9, WI-10)*
