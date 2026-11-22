/**
 * One process-wide cap on concurrent Chromium renders (Phase 13 WI-1).
 *
 * Each `renderPageHtml` (modules/price/ and modules/reviews/, duplicated per
 * CLAUDE.md §5) launches its own browser, and price fans its "still listed"
 * checks out with `Promise.all` — so one price fetch can start several
 * Chromiums at once, on top of whatever a reviews fetch is rendering. On the
 * laptop that is only slow; on a 1 GB cloud machine it is the out-of-memory
 * case the spec names as R2 ("peak is set by render concurrency"). Both
 * modules take a slot here before launching, so the cap holds across them.
 *
 * `RENDER_CONCURRENCY` sets the cap. Unset or 0 means no cap — local
 * development keeps the behaviour the ground-truth baselines were measured
 * with; fly.toml sets the production value, right-sized from WI-5.
 *
 * Lives in shared/ because both modules need the same counter and modules do
 * not import each other (CLAUDE.md §5).
 *
 * Since 2026-11-03 the same file also keeps one shared browser
 * (`withSharedBrowser`, below) instead of a launch per render.
 */

/** Chromium flags safe inside a container (no setuid sandbox, small /dev/shm). */
export const CHROMIUM_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']

function configuredLimit(): number {
  const n = Number(process.env.RENDER_CONCURRENCY ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Infinity
}

let active = 0
const waiting: Array<() => void> = []

/** Runs `fn` once a render slot is free; the slot is released when it settles. */
export async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= configuredLimit()) {
    await new Promise<void>(resolve => waiting.push(resolve))
  } else {
    active++
  }
  try {
    return await fn()
  } finally {
    // Hand the slot straight to the next waiter (active stays the same), or free it.
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}

/** Renders in flight right now — for tests and the shutdown log. */
export function activeRenders(): number {
  return active
}

// ── One shared browser (2026-11-03) ──────────────────────────────────────────
//
// Launching Chromium was a large share of each render: about 0.4 s of a 1 s
// render of a near-empty page on Fly, unthrottled. A wine's lookup renders
// many pages, so both modules now share one browser, opened on the first
// render and closed after BROWSER_IDLE_MS (default 15 s) with nothing to
// render. That way a finished script exits promptly and an idle server holds
// no Chromium. Each render gets its own browser context, so cookies and storage
// never carry from one retailer's page to the next, as with a fresh browser.
// A crashed or disconnected browser is dropped and relaunched on the next
// render. The render slot above still caps how many pages render at once.
//
// The type is structural so shared/ needs no Puppeteer import (the web app
// type-checks this directory too); each module passes its own launcher, and
// both launch the same way.

export interface PooledBrowser {
  readonly connected: boolean
  close(): Promise<void>
  once(event: 'disconnected', handler: () => void): unknown
}

let browserPromise: Promise<PooledBrowser> | null = null
let users = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null

function idleMs(): number {
  const n = Number(process.env.BROWSER_IDLE_MS ?? 15_000)
  return Number.isFinite(n) && n >= 0 ? n : 15_000
}

async function getBrowser(launch: () => Promise<PooledBrowser>, retried = false): Promise<PooledBrowser> {
  if (!browserPromise) {
    const p = launch().then((b) => {
      b.once('disconnected', () => {
        if (browserPromise === p) browserPromise = null
      })
      return b
    })
    // A failed launch must not stick: the next render tries again.
    p.catch(() => {
      if (browserPromise === p) browserPromise = null
    })
    browserPromise = p
  }
  const current = browserPromise
  const browser = await current
  if (browser.connected) return browser
  if (browserPromise === current) browserPromise = null
  // A browser that died between launches: relaunch once, never loop.
  if (retried) throw new Error('Chromium launched but is not connected')
  return getBrowser(launch, true)
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (users > 0) return
    void closeSharedBrowser()
  }, idleMs())
  // Never keep the process alive just to close an idle browser.
  ;(idleTimer as { unref?: () => void }).unref?.()
}

/**
 * Runs `fn` with the shared browser once a render slot is free. `launch` is
 * used only when no browser is open.
 */
export function withSharedBrowser<B extends PooledBrowser, T>(launch: () => Promise<B>, fn: (browser: B) => Promise<T>): Promise<T> {
  return withRenderSlot(async () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    users++
    try {
      const browser = (await getBrowser(launch)) as B
      return await fn(browser)
    } finally {
      users--
      if (users === 0) scheduleIdleClose()
    }
  })
}

/** Closes the shared browser now (graceful shutdown, tests). Safe to call twice. */
export async function closeSharedBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  const p = browserPromise
  browserPromise = null
  if (!p) return
  try {
    const b = await p
    await b.close()
  } catch {
    // Already gone, or never launched: nothing to close.
  }
}
