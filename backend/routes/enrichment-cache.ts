import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import type { ReviewProbeLogEntry } from '@shared/types'

/**
 * Freshness and coalescing for the two metered enrichment routes
 * (Phase 9.2, WI-4).
 *
 * Before this, every click on "Refresh Price" or "Refresh Reviews" was a
 * full-price re-run, and a double-click was two of them. Neither route had any
 * notion of already having the answer.
 *
 * Two independent mechanisms, because they solve different problems:
 *
 * - the TTL stops re-asking a question whose answer has not had time to change;
 * - coalescing stops asking the *same* question twice concurrently, which no
 *   TTL can catch because the first answer has not been stored yet.
 *
 * Lives beside the routes rather than in a module: it is about how the HTTP
 * surface spends money, not about how either module does its work.
 */

/**
 * How long stored enrichment counts as current.
 *
 * These differ because they are different kinds of fact, not because one
 * matters more. A retailer's price moves week to week. A critic score
 * published against a vintage does not move at all — what changes is only
 * whether some shop has newly put up a page carrying it.
 */
export const PRICE_TTL_DAYS = 7
export const REVIEWS_TTL_DAYS = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Whether stored data timestamped `fetchedAt` is still inside its TTL.
 *
 * A null/absent/unparseable timestamp is never fresh: "we have no idea when
 * this was fetched" must fall through to fetching, not to trusting it.
 */
export function isWithinTtl(
  fetchedAt: string | null | undefined,
  ttlDays: number,
  now: Date = new Date()
): boolean {
  if (!fetchedAt) return false
  const then = Date.parse(fetchedAt)
  if (Number.isNaN(then)) return false
  const age = now.getTime() - then
  // A timestamp in the future is a clock problem, not freshness — treat it as
  // fresh rather than as infinitely stale, since the alternative is a
  // permanent full-price re-run on every click.
  return age < ttlDays * MS_PER_DAY
}

/** The most recent of a set of ISO timestamps, ignoring absent and
 * unparseable ones. Null when none survive. review_data timestamps each
 * retailer separately, so the wine's own freshness is the newest of them. */
export function newestTimestamp(values: Array<string | null | undefined>): string | null {
  let newest: string | null = null
  let newestMs = -Infinity
  for (const value of values) {
    if (!value) continue
    const ms = Date.parse(value)
    if (Number.isNaN(ms) || ms <= newestMs) continue
    newest = value
    newestMs = ms
  }
  return newest
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * Runs `fn`, or joins the run already under way for the same key.
 *
 * This is what actually stops double-click spend, and it is independent of the
 * TTL: at the moment the second click arrives, the first run has not written
 * anything yet, so there is no stored `fetched_at` for a freshness check to
 * read. Both callers get the same outcome — including the same failure, which
 * is correct: they asked the same question at the same time.
 */
export function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const promise = fn().finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}

/** Number of runs currently in flight — for tests and diagnostics. */
export function inFlightCount(): number {
  return inFlight.size
}

/**
 * Whether stored review_data can satisfy a `tier=full` request as-is
 * (Phase 9.4, WI-5).
 *
 * A `tier=primary` auto-fire probes only primary-tier retailers, so its
 * probe log carries no entry for any 'extended'-tier slug. Reading that
 * absence back is how a later `tier=full` request tells "this was a
 * primary-only run" apart from "this was already a full run" — without a new
 * column. `force=true` clears the probe log and isn't a substitute: it also
 * discards the negative-probe memory that keeps a later full run cheap.
 *
 * One case is deliberately over-invalidated: a full run whose primary tier
 * itself found a score never touches the extended tier either (see
 * fetchReviewData's foundNoScore gate), so its probe log looks identical to
 * a primary-only run's. That run gets re-run once more on the next
 * `tier=full` click than strictly necessary — a bounded, ~primary-tier-cost
 * re-check, not a wrong result — which is the trade this heuristic accepts
 * in exchange for not adding a column.
 */
export function reachedExtendedTier(probeLog: ReviewProbeLogEntry[] | null | undefined): boolean {
  if (!probeLog || probeLog.length === 0) return false
  return probeLog.some((entry) => {
    const config = RETAILER_CONFIG.find((r) => r.slug === entry.slug)
    return config?.reviewTier === 'extended'
  })
}
