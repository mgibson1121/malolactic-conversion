/**
 * Per-retailer negative-result memory for review sourcing (Phase 9.2, WI-5).
 *
 * A retailer that returned zero_results for a specific bottling burns the
 * full query-variant ladder every single run to learn the same thing again.
 * Whether Sokolin has ever indexed a page for a given Chablis does not change
 * week to week, even though prices do — so a genuine negative is worth
 * remembering for a while.
 *
 * The one rule everything here exists to protect: skip on `zero_results`
 * only. Not `no_relevant_match` — results existed there, and Phase 9.1
 * changed the ranking that judges them, so a later run may now pick
 * differently. And categorically never on `request_failed` — reading a
 * transient failure as a negative result is the exact conflation that erased
 * eight wines' review_data on 2026-08-05, and this cache must not recreate it
 * with a longer fuse.
 */

import type { ReviewProbeLogEntry } from '@shared/types'

/** How long a genuine zero_results probe is trusted before it is asked again. */
export const NEGATIVE_PROBE_TTL_DAYS = 90

/** The most recent probe recorded for a retailer, if any. */
export function findProbeEntry(
  log: ReviewProbeLogEntry[] | null | undefined,
  slug: string
): ReviewProbeLogEntry | undefined {
  return (log ?? []).find(e => e.slug === slug)
}

/**
 * Whether a stored probe should suppress searching this retailer again this
 * run.
 */
export function shouldSkipProbedRetailer(
  entry: ReviewProbeLogEntry | undefined,
  now: Date = new Date()
): boolean {
  if (!entry) return false
  if (entry.stage !== 'zero_results') return false
  const probedAt = Date.parse(entry.probed_at)
  if (Number.isNaN(probedAt)) return false
  const ageDays = (now.getTime() - probedAt) / (24 * 60 * 60 * 1000)
  return ageDays < NEGATIVE_PROBE_TTL_DAYS
}

/**
 * Merges one run's fresh probe entries into a wine's stored log, replacing by
 * slug.
 *
 * A retailer not searched this run — skipped by a still-valid negative probe,
 * or an extended-tier retailer never reached because the primary tier already
 * found a score — keeps whatever entry it already had rather than losing its
 * history. Only a retailer this run actually queried gets overwritten, with
 * that query's real outcome.
 */
export function mergeProbeLog(
  existing: ReviewProbeLogEntry[] | null | undefined,
  fresh: ReviewProbeLogEntry[]
): ReviewProbeLogEntry[] {
  const bySlug = new Map((existing ?? []).map(e => [e.slug, e] as const))
  for (const entry of fresh) bySlug.set(entry.slug, entry)
  return [...bySlug.values()]
}
