import { config } from 'dotenv'
import path from 'path'
// The repo-root .env, from source (backend/server.ts) or from the compiled
// build (backend/dist/backend/server.js). Missing files are skipped; in the
// cloud there is no .env and the keys arrive as Fly secrets (Phase 13).
config({ path: [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../../.env')] })
import { createApp, optionsFromEnv } from './app'
import { getStorage, closeStorage } from './modules/storage'
import { activeRenders } from '@shared/utils/render-gate'
import { activeJobCount, recoverInterruptedJobs, waitForJobs } from './routes/enrichment-jobs'

const options = optionsFromEnv()
const app = createApp(options)
const devices = options.deviceTokens ?? []
console.log(
  devices.length > 0
    ? `Device tokens: ${devices.length} (${devices.map(d => d.name).join(', ')})`
    : 'Authentication is OFF (no DEVICE_TOKENS) — local development only'
)

// Phase 9.4, WI-7 — drafts (promoted_at NULL) older than 24h are deleted, on
// server start and once per 24h thereafter. A swept draft takes its
// review_data with it; re-scanning that wine later costs a fresh fetch. See
// CLAUDE.md §15's billing note for why that trade is fine at current volume.
// Under Fly's idle auto-stop (Phase 13) the process rarely lives 24h, so in
// practice the sweep runs on each wake-up; it is idempotent, so that is fine.
const DRAFT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

function sweepStaleDrafts() {
  const cutoff = new Date(Date.now() - DRAFT_MAX_AGE_MS)
  getStorage()
    .sweepStaleDrafts(cutoff)
    .then((count) => {
      if (count > 0) console.log(`Draft sweep: removed ${count} stale draft(s) older than 24h`)
    })
    .catch((err) => console.error('Draft sweep failed:', err))
}

const PORT = Number(process.env.PORT ?? 3000)
// All interfaces: the phone reaches a laptop backend over the LAN, and Fly's
// proxy reaches the container on its private address.
const HOST = process.env.HOST ?? '0.0.0.0'
let sweepTimer: NodeJS.Timeout | undefined
const server = app.listen(PORT, HOST, () => {
  console.log(`Wine app backend listening on ${HOST}:${PORT}`)
  sweepStaleDrafts()
  // Phase 14 WI-1: nothing runs in a process that has just started, so a job
  // the database still calls 'running' belonged to a machine that stopped.
  recoverInterruptedJobs()
    .then((count) => {
      if (count > 0) console.log(`Marked ${count} wine(s) with a search interrupted by the last stop`)
    })
    .catch((err) => console.error('Recovering interrupted searches failed:', err))
  sweepTimer = setInterval(sweepStaleDrafts, DRAFT_SWEEP_INTERVAL_MS)
  sweepTimer.unref()
})

// Phase 13 WI-1 — graceful shutdown. Fly sends SIGTERM (fly.toml kill_signal)
// when it stops an idle machine or replaces it on deploy. Stop accepting
// connections, let in-flight requests finish (an enrichment fetch can run
// for a minute), then checkpoint the WAL and close the database. Must stay
// under fly.toml's kill_timeout, after which the machine is killed outright.
// A second signal (Ctrl-C twice locally) skips the wait.
//
// Phase 14 WI-3 — a running search is waited for as well as an open request.
// A search whose client has gone away (a locked phone, a dropped connection)
// has no request open, and server.close() does not wait for work it cannot
// see, so the process would exit under it. A search that outlasts the grace
// is marked interrupted before the database closes, so the next read says so
// at once and the app can resume it (the saved shops are not repeated).
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 110_000)
let shuttingDown = false

function finish(code: number): never {
  try {
    closeStorage()
  } catch (err) {
    console.error('Closing the database failed:', err)
    code = 1
  }
  process.exit(code)
}

function shutdown(signal: string) {
  if (shuttingDown) {
    console.log(`${signal} again: closing now`)
    finish(1)
  }
  shuttingDown = true
  console.log(
    `${signal}: no new connections; waiting for in-flight requests and ${activeJobCount()} search(es) (${activeRenders()} render(s) running)`
  )
  if (sweepTimer) clearInterval(sweepTimer)
  setTimeout(() => {
    console.error(`Shutdown: work still open after ${SHUTDOWN_GRACE_MS}ms; marking searches interrupted and closing`)
    recoverInterruptedJobs().then(
      () => finish(1),
      () => finish(1)
    )
  }, SHUTDOWN_GRACE_MS).unref()
  const closed = new Promise<void>((resolve) => server.close(() => resolve()))
  server.closeIdleConnections()
  Promise.all([closed, waitForJobs(SHUTDOWN_GRACE_MS)]).then(() => finish(0))
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default app
