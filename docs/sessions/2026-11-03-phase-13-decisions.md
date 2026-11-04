# Session — Phase 13 decisions, Phase 13.1 spec (2026-11-03)

Branch `service/phase-13-shared-browser-and-decisions`, from `main` after #56. Continues `docs/sessions/2026-11-01-phase-13.md`.

## Decisions (recorded in the Phase 13 spec, D10–D14, and in `CLAUDE.md` §3)

- **Production app name `malolactic-conversion`**, reserved on Fly as an empty app (no machine, volume or secret). `fly.toml` points at it.
- **Cold start (about 4 s) is acceptable; idle stop stays.**
- **Hourly metered limit raised from 60 to 100** per device; 200 a day unchanged. Code default in `backend/middleware/metered-rate-limit.ts`.
- **WI-6 deploys only on app-code changes.**
- **The data upload is its own phase, Phase 13.1** (`docs/specs/2026-11-03-phase-13.1-data-cutover.md`, drafted for review), run after WI-9 so the laptop and cloud copies never both take changes.

## Tried and set aside: one shared Chromium

You asked for the "reuse one browser" speed-up to be built now. It was built: one Chromium shared by price and reviews, a fresh context per page, closed after 15 s idle, closed on shutdown, with tests. Then it was measured on the laptop against 15 real retailer product pages from the 14-wine run, 3 at a time and with no metered calls:
- one browser per page: 14.8 s and 15.7 s;
- shared browser: 16.5 s both times;
- all 15 pages rendered either way.

Launching Chromium is cheap on the M3, so there was nothing to save. Fly's fewer, slower cores might still benefit, but that is unmeasured. So it is **not** in this branch. It's on its own branch, `service/phase-13-shared-browser`, with a draft PR, until it's measured on a Fly machine. The Woodland Hills timeout change was not made either: on 4 CPUs those failures disappeared (WI-5 size test), so there is nothing to fix.

## Still open

- WI-4 backup method: Litestream (recommended), a copy at shutdown, or a scheduled waking job.
- WI-9 promotion step: tag (default) or click. Your reply "Let's do my wife" wasn't clear enough to record.

## WI-4 built, deployed and drilled (same day)

- **Litestream to R2** (you chose it): PR #60. It merged `main` twice: once for #57/#59, once for the WI-6 session's concurrent push, which added `docker-entrypoint.sh` and `litestream.yml` to the deploy trigger.
- **Production deployed** to `malolactic-conversion` on `performance-4x`. You set the four `LITESTREAM_*` secrets. The session added the API keys and a **temporary `wi4-drill` device token**, which your real three tokens replace (runbook, "Device tokens").
- **Both restore drills passed:** beside the live database, and after destroying the machine and volume. The change written right before shutdown survived. Test data is removed, and production is empty, awaiting Phase 13.1.
- Your first `fly secrets set` attempt failed on the `<…>` placeholders (zsh redirection); `fly secrets import` worked. The failed line, with the key, may sit in `~/.zsh_history`.
