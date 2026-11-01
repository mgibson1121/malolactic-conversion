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
