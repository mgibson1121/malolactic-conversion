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

The workflow `.github/workflows/deploy.yml` ("Deploy backend") deploys production, the app `malolactic-conversion` (`https://malolactic-conversion.fly.dev`). It runs after every CI run that passes on a push to `main`. It deploys only when app code changed since the release that is running now (spec D13): `backend/`, `shared/`, `web/`, `Dockerfile`, `.dockerignore`, `docker-entrypoint.sh`, `litestream.yml`, `fly.toml`, `package.json`, `package-lock.json`. Docs-only and iOS-only merges skip, and the run's summary says why. Each deploy tags its image `git-<commit>`, which is how the next run knows which commit is live. Only one deploy runs at a time; a later one waits.

**One-time setup** (after WI-4 has created the production volume and secrets; until then every run skips with a notice, because production refuses to start without `DEVICE_TOKENS` or the four `LITESTREAM_*` backup secrets, see "Backup and restore"):

1. A deploy token that can manage only this app. Fly's default lifetime is 20 years; a shorter `--expiry` means a reminder to renew it. Pipe it straight into the GitHub secret, so it never lands on the screen or in a file:
   ```bash
   fly tokens create deploy --app malolactic-conversion --name github-actions-deploy \
     | gh secret set FLY_API_TOKEN --repo mgibson1121/malolactic-conversion
   ```
   The value is the whole output, starting `FlyV1 `.
2. A smoke-test device token. It is the fourth pair, `smoke-test`, issued together with the three devices in "Device tokens: issue the set" below (one `fly secrets set`, which replaces the whole list, so never set a partial list). Copy that `smoke-test` token into the GitHub secret, typed or pasted at the prompt so it stays off the screen and out of shell history:
   ```bash
   gh secret set SMOKE_DEVICE_TOKEN --repo mgibson1121/malolactic-conversion
   ```
   It only reads the wine list, and the workflow never prints the response, because the repository and its logs are public. Removing the pair from `DEVICE_TOKENS` makes the next deploy's smoke test fail.
3. First deploy: GitHub → Actions → **Deploy backend** → **Run workflow** on `main` (or `gh workflow run deploy.yml --ref main`). A manual run deploys `main`'s head if CI has passed on it, and skips the app-code check. `--ha=false` keeps it to one machine (SQLite is single-writer, D4).

If `FLY_API_TOKEN` is set but `SMOKE_DEVICE_TOKEN` is not, the run fails before deploying, since nothing could check the result.

**See a deploy.**
- GitHub: Actions → **Deploy backend**. Each run's summary says deployed, skipped or failed, and why. A failed run is red, and GitHub emails the person who pushed. From the terminal: `gh run list --workflow deploy.yml`, and `gh run watch` for one in progress.
- Fly: `fly releases --app malolactic-conversion --image` lists releases with their images (`git-<commit>` names the commit); `fly status` and `fly logs` show the machine.

**Smoke test** (after every deploy): `/healthz` answers `{"status":"ok"}` within a minute (a stopped machine takes a few seconds to wake), `GET /api/wines` without a token is `401` (auth is on), and with `SMOKE_DEVICE_TOKEN` it is `200` with a JSON list. If any check fails, the run fails. The new release stays live, so decide whether to roll back.

**Roll back** by redeploying the previous release's image. Nothing is rebuilt. Run from the repo root so `fly.toml` applies:
```bash
fly releases --app malolactic-conversion --image
fly deploy --app malolactic-conversion --ha=false --image registry.fly.io/malolactic-conversion:git-<previous commit>
```
Then fix `main` (revert the bad PR) before merging anything else. While the live release is older than `main`, the next merge to `main` redeploys `main`'s head, docs-only merges included, because the app code differs from what is live. To hold deploys meanwhile: `gh workflow disable deploy.yml` (and `enable` afterwards). A rollback restores code, not data: a migration the bad release ran stays applied (spec R6; WI-4's backups cover that).

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
- `fly ssh console --app malolactic-conversion -C "litestream databases"` lists `/data/wine.db` with replica `s3`.
- At start, "no matching backups found" appears only on the very first boot of an empty app. A restore onto an empty volume prints nothing, so the absence of that line on a fresh volume means it restored.
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
4. They must match. (Last run 2026-11-03: matched, and the lost-volume restore below also passed. See build-phases, Phase 13 WI-4.)

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

**Issue the set** (once, before the first phone uses production; Phase 13.1 precondition 4). Production currently holds only a temporary `wi4-drill` token from WI-4's restore drill; setting the list below replaces it. Generate one token per device plus the deploy workflow's smoke-test token, and keep them out of the repo and out of chat; a password manager is the right home:
One command, in your own Terminal (not a chat or the `!` prompt). It generates the four keys into a file only you can read, joins them and sets them, without printing them:
```bash
umask 077; for d in matt-iphone household-iphone web smoke-test; do echo "$d:$(openssl rand -hex 32)"; done > ~/wine-device-keys.txt && fly secrets set --app malolactic-conversion DEVICE_TOKENS="$(paste -sd, ~/wine-device-keys.txt)"
```
Copy the four lines into your password manager, then `rm ~/wine-device-keys.txt`. **Never set the list by hand with placeholders:** on 2026-11-07, `DEVICE_TOKENS="matt-iphone:…,…"` was set literally, and production refused to start until real keys replaced it. A key is ≥ 32 characters, and the server fails closed on anything shorter. A device's key is the part **after** `name:` (64 characters); that's what goes into the app.
Put the `smoke-test` token into the GitHub secret `SMOKE_DEVICE_TOKEN` ("Deploy and rollback" above). Check with `fly logs --app malolactic-conversion | grep 'Device tokens'`: four names, no `wi4-drill`.
Setting a secret restarts the machine. Give each person their own token privately (WI-10). It goes into the iPhone app's Access key field (WI-7), or into the web app's prompt once per browser.

**Revoke one device.** Set `DEVICE_TOKENS` again without that device's pair. The other devices keep working. The revoked device's next request gets `401`; the web app then drops its stored key and asks again.

**Rotate one device.** Replace that device's token in the list, set the secret, and enter the new token on that device.

**Check which devices are configured.** The machine logs device names (never tokens) at start: `fly logs --app <app> | grep 'Device tokens'`.

**Rate limits.** Each device may make 100 metered calls an hour and 200 a day: label scans, tasting-note saves, and price/review fetches. Beyond that the API answers `429` with `Retry-After`, and the log names the device (`Metered rate limit: <device> refused …`). Override the limits with `METERED_LIMIT_PER_HOUR` / `METERED_LIMIT_PER_DAY` in `fly.toml` `[env]`. The counts reset when the machine stops or restarts.

**Entering the key on an iPhone (WI-7).** A TestFlight (Release) build opens on the Server screen until it has a key: paste the device's token into **Access key** and tap Save. It is stored in that phone's Keychain only, and isn't restored to a new phone, so enter it again there. If the key is revoked or mistyped, the app returns to the same screen with "That key wasn't accepted." A Debug build against a local backend needs no key unless that backend has `DEVICE_TOKENS` set.

**Forcing an app update (WI-8).** Set `MIN_IOS_BUILD` to the lowest `CFBundleVersion` the server should still serve, only once that build is in TestFlight for everyone:
```bash
fly secrets set --app malolactic-conversion MIN_IOS_BUILD=<build>
```
Older apps then show "Update available in TestFlight." The web app and scripts are unaffected (they send no build header). To remove the check, run `fly secrets unset --app malolactic-conversion MIN_IOS_BUILD`. Each TestFlight upload needs a higher build number (`CURRENT_PROJECT_VERSION`, currently 1) anyway, which WI-9 handles.

**Laptop web app against the cloud.** Put `WINE_API_TARGET=https://<app>.fly.dev` and `WINE_ACCESS_KEY=<the web token>` in `.env`, then run `npm run dev:web`. The Vite proxy adds the header, so the key is never in the bundle or the browser.

## TestFlight: add a tester, promote a build, expired builds *(WI-9, WI-10)*

**Xcode Cloud workflow `TestFlight – Developer`** (set up 2026-11-07, WI-9 step 1, D16). It lives in App Store Connect/Xcode, not in the repo, so its settings are recorded here. Edit it in Xcode: Report navigator (⌘9) → Cloud → right-click the workflow → Edit Workflow.
- Environment: Xcode and macOS "Latest Release".
- Start conditions: **Branch Changes** on `main`, only when files in `ios/` change (auto-cancel on); **Manual Start – Branch**.
- Action: **Archive – iOS**, scheme `WineApp`, distribution preparation **TestFlight (Internal Testing Only)**.
- Post-action: **TestFlight Internal Testing** → group `Developer`.
- App Store Connect app: "Malolactic Conversion", bundle ID `com.mgibson.WineApp`. The home-screen name stays "Wine".
- Xcode shows "the scheme 'WineApp' may only exist locally" on the Archive action. It's a caution: the shared scheme is in the repo (`ios/WineApp.xcodeproj/xcshareddata/xcschemes/`).
- `ios/WineApp.xcodeproj/xcshareddata/xcodecloud/manifest.json` links the project's targets to the Xcode Cloud product. It holds IDs only; keep it committed.
- **Export compliance:** the app target sets `ITSAppUsesNonExemptEncryption = NO` (standard HTTPS only), so builds don't wait on the encryption question. If the app ever adds its own encryption, this must change.

**Install on a phone:** TestFlight app (same Apple ID) → Wine → Install → enter the device's access key ("Device tokens" above). If TestFlight only shows **"Redeem"** (asks for a code), the phone's Apple ID hasn't got an invitation yet: add the person to the internal group in App Store Connect (TestFlight → Internal Testing → the group → Testers +) and accept the emailed invitation on the phone. Internal testers never need a code.

**First result (2026-11-07):** build 0.1 (2) on the developer's iPhone, key accepted, empty production cellar.
