# Operations runbook

> Phase 13 (spec: `docs/specs/2026-10-10-phase-13-production-deployment.md`). Started 2026-11-01 with WI-1–WI-3; sections marked *(WI-n)* are filled in as that work item is built. WI-11 completes this file.

The production backend is one Fly.io machine (`fly.toml`, region `iad`) running the root `Dockerfile`: the compiled API plus the built web app, with SQLite at `/data/wine.db` on the volume `wine_data`. API keys are Fly secrets, never in the repo or the image.

## One-time setup

```bash
brew install flyctl
fly auth login
```

## WI-5 — staging deployment test (go/no-go gate)

A throwaway app proves the container works from a datacenter before anything real moves. It uses a fresh, empty database, so the collection is never touched.

Device tokens (WI-3) are already in place, so the staging app answers only requests that carry its token. Production mode refuses to start without one. Destroy the app after the test anyway (last step): it is a second copy of the keys.

1. Create the app and its volume (Fly app names are global; pick any free name):
   ```bash
   fly apps create wine-staging-<suffix>
   fly volumes create wine_data --app wine-staging-<suffix> --region iad --size 3 --yes
   ```
2. Copy only the two keys from `.env` into Fly secrets, and give the staging app its own throwaway device token. The token lives only in this terminal's `STAGING_TOKEN` variable, never in a file in the repo; if the terminal is closed, set a new one the same way:
   ```bash
   grep -E '^(OPENAI_API_KEY|SERPER_API_KEY)=' .env | fly secrets import --app wine-staging-<suffix>
   STAGING_TOKEN=$(openssl rand -hex 32)
   fly secrets set --app wine-staging-<suffix> DEVICE_TOKENS="staging-test:$STAGING_TOKEN"
   ```
3. Deploy. `--ha=false` keeps it to one machine, because SQLite is single-writer (spec D4):
   ```bash
   fly deploy --app wine-staging-<suffix> --ha=false
   ```
   The first build runs on Fly's remote builder; this is also the first time the `Dockerfile` is built at all.
4. Smoke test. The first call needs no token. The second must be refused (`401`), and the third must succeed:
   ```bash
   curl -s https://wine-staging-<suffix>.fly.dev/healthz
   curl -s -o /dev/null -w '%{http_code}\n' https://wine-staging-<suffix>.fly.dev/api/wines
   curl -s -H "Authorization: Bearer $STAGING_TOKEN" https://wine-staging-<suffix>.fly.dev/api/wines
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
8. Destroy the staging app (this deletes its volume and its secrets too):
   ```bash
   fly apps destroy wine-staging-<suffix> --yes
   unset STAGING_TOKEN
   ```

If the gate fails, the spec's fallback is the same container on a home machine behind a Cloudflare Tunnel.

## Tuning

- **Machine size: `performance-4x` (4 dedicated CPUs, 8 GB), set in `fly.toml` `[[vm]]`** (chosen 2026-11-02 after the WI-5 size test: 1.2× the laptop's time, against 1.9× on 1 CPU). WI-5 showed that a shared CPU is throttled to 6.25% of a core once its burst balance runs out, and Chromium renders then time out. Don't move to a shared CPU to save money without re-running WI-5. `fly scale vm` changes a running machine, but the next `fly deploy` resets it to `fly.toml`.
- `RENDER_CONCURRENCY` (`fly.toml`, `[env]`) caps concurrent Chromium renders across price and reviews. Set to 4 (one per CPU); the 14-wine run peaked at about 1.6 GB of 8 GB. Lower it if a scan runs out of memory; raise it only with a new measurement.
- **Measuring memory and throttling yourself:** inside the machine, `MemAvailable` in `/proc/meminfo` (sampled while the work runs) gives peak use, and the 8th number on the `cpu` line of `/proc/stat` (steal) shows CPU withheld by Fly. The Fly dashboard's Metrics tab shows the same memory figure.
- `SHUTDOWN_GRACE_MS` must stay below `kill_timeout`.

## Deploy and rollback *(WI-6)*

## Backup and restore *(WI-4)*

**What runs.** Three layers:
1. **Litestream** (`litestream.yml`, started by `docker-entrypoint.sh`) streams every database change to the Cloudflare R2 bucket about once a second while the machine is awake. It takes a snapshot hourly and keeps 30 days of history, so any moment in the last 30 days can be restored.
2. **A copy before every schema migration**, made by the server itself, on the volume as `/data/wine.db.pre-migrate-<timestamp>`.
3. **Fly's automatic daily volume snapshots**, the last resort (`fly volumes snapshots list <volume-id>`).

Production refuses to start without the four Litestream secrets. A throwaway staging app sets `LITESTREAM_DISABLED=true` instead.

**One-time setup (developer, in your own Terminal so the key never passes through chat).** From Cloudflare you need the bucket name, the account's S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`, shown on the bucket's settings page) and the R2 API token's access key ID and secret:
```bash
fly secrets set --app malolactic-conversion --stage LITESTREAM_BUCKET=<bucket> LITESTREAM_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com LITESTREAM_ACCESS_KEY_ID=<access-key-id> LITESTREAM_SECRET_ACCESS_KEY=<secret>
```
`--stage` stores them for the next deploy without restarting anything.

**Is it working?**
- `fly logs --app malolactic-conversion | grep -i litestream` shows replication starting at each wake-up and no errors.
- `fly ssh console --app malolactic-conversion -C "litestream databases"` lists `/data/wine.db` with its replica.
- In the R2 dashboard, the bucket has a `wine.db/` folder whose files update after a change.

**Restore drill (done once at WI-4, repeat after any change to the backup setup).**
1. Make a change through the app and wait a few seconds.
2. Restore the latest backup **beside** the live database, never over it:
   ```bash
   fly ssh console --app malolactic-conversion -C "litestream restore -o /tmp/drill.db /data/wine.db"
   ```
3. Compare counts between the restored copy and the live database:
   ```bash
   fly ssh console --app malolactic-conversion -C "node -e \"const D=require('better-sqlite3');for(const f of ['/data/wine.db','/tmp/drill.db']){const d=new D(f,{readonly:true});console.log(f,d.prepare('select (select count(*) from wines) w,(select count(*) from tasting_notes) n').get())}\""
   ```
4. They must match.

**Lost volume (machine or disk gone).** Create a fresh volume and deploy. On the empty volume, `docker-entrypoint.sh` restores the latest backup before the server opens the database. On the first start of a brand-new app there is no backup yet, and it starts empty.

**Roll back to an earlier moment** (a bad migration or a mistaken bulk change). Restore that moment beside the live database:
```bash
fly ssh console --app malolactic-conversion -C "litestream restore -timestamp 2026-11-03T12:00:00Z -o /tmp/pit.db /data/wine.db"
```
Check it as in the drill. Putting it in place of the live database uses Phase 13.1's import-on-start, which runs before Litestream so the backup history follows the swap. Until 13.1 is built, roll back from the newest `/data/wine.db.pre-migrate-*` copy the same way.

**Housekeeping.** Pre-migration copies are only made when a deploy brings a new migration, so they're rare. Delete old ones once a deploy is known good: `fly ssh console -C "ls -l /data"`, then `rm` the ones you don't need.

## Data cutover *(Phase 13.1)*

The one-time move of the laptop database to production: `docs/specs/2026-11-03-phase-13.1-data-cutover.md` §5. The steps land here when Phase 13.1 is built.

## Device tokens: issue, rotate, revoke *(WI-3)*

One Fly secret, `DEVICE_TOKENS`, holds every device as comma-separated `name:token` pairs. Production issues three: the developer's iPhone, the household iPhone and the web app. A token identifies a device, not a person, and each one is revoked on its own.

**Issue the set** (once, at production cutover). Generate one token per device and keep them out of the repo and out of chat; a password manager is the right home:
```bash
for d in matt-iphone household-iphone web; do echo "$d:$(openssl rand -hex 32)"; done
```
Join the three lines with commas into one value and set it:
```bash
fly secrets set --app <app> DEVICE_TOKENS="matt-iphone:…,household-iphone:…,web:…"
```
Setting a secret restarts the machine. Give each person their own token privately (WI-10). It goes into the iPhone app's Access key field (WI-7), or into the web app's prompt once per browser.

**Revoke one device.** Set `DEVICE_TOKENS` again without that device's pair. The other devices keep working. The revoked device's next request gets `401`; the web app then drops its stored key and asks again.

**Rotate one device.** Replace that device's token in the list, set the secret, and enter the new token on that device.

**Check which devices are configured.** The machine logs device names (never tokens) at start: `fly logs --app <app> | grep 'Device tokens'`.

**Rate limits.** Each device may make 100 metered calls an hour and 200 a day: label scans, tasting-note saves, and price/review fetches. Beyond that the API answers `429` with `Retry-After`, and the log names the device (`Metered rate limit: <device> refused …`). Override the limits with `METERED_LIMIT_PER_HOUR` / `METERED_LIMIT_PER_DAY` in `fly.toml` `[env]`. The counts reset when the machine stops or restarts.

**Laptop web app against the cloud.** Put `WINE_API_TARGET=https://<app>.fly.dev` and `WINE_ACCESS_KEY=<the web token>` in `.env`, then run `npm run dev:web`. The Vite proxy adds the header, so the key is never in the bundle or the browser.

## TestFlight: add a tester, promote a build, expired builds *(WI-9, WI-10)*
