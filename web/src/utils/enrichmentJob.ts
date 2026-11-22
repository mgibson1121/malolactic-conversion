import type { EnrichmentJobs, PriceJob, ReviewsJob, WineEntry } from '@shared/types'

/**
 * What the app says about a running lookup (Phase 14 WI-6). Mirrors
 * `ReviewSearch` / `PriceSearch` in the iOS app (`Models/EnrichmentJob.swift`),
 * so the two clients word the same state the same way and neither re-derives
 * it differently. The server writes `wines.enrichment_job`; the app only reads.
 */

export type JobKind = 'reviews' | 'price'

export const reviewsJobOf = (wine: WineEntry): ReviewsJob | null => wine.enrichment_job?.reviews ?? null
export const priceJobOf = (wine: WineEntry): PriceJob | null => wine.enrichment_job?.price ?? null

/** Either lookup is running on the server right now. */
export function jobsRunning(wine: WineEntry): boolean {
  const jobs: EnrichmentJobs | null | undefined = wine.enrichment_job
  return jobs?.reviews?.state === 'running' || jobs?.price?.state === 'running'
}

export interface ReviewSearch {
  /** A search is under way: the server says so, or this app's own request is out. */
  isSearching: boolean
  /** The server stopped it part-way (its machine did); it can be run again. */
  isInterrupted: boolean
  /** It could not run at all. */
  hasFailed: boolean
  shopsDone: number
  shopsTotal: number
  scoresFound: number
  /** "Checked 7 of 11 shops · 2 scores so far" while it runs, "Checked 11 shops"
   * once it has; null when there is nothing true to say yet (no count). */
  metaLine: string | null
  /** The empty result with how hard it looked, and no button. */
  noneLine: string
}

const shopsWord = (n: number) => (n === 1 ? 'shop' : 'shops')

export function reviewSearchOf(wine: WineEntry, busy: boolean): ReviewSearch {
  const job = reviewsJobOf(wine)
  const isSearching = busy || job?.state === 'running'
  const shopsTotal = job?.shops_total ?? 0
  const shopsDone = Math.min(job?.shops_done ?? 0, shopsTotal)
  const scoresFound = job?.scores_found ?? 0
  let metaLine: string | null = null
  if (shopsTotal > 0) {
    metaLine = isSearching
      ? `Checked ${shopsDone} of ${shopsTotal} ${shopsWord(shopsTotal)}` +
        (scoresFound > 0 ? ` · ${scoresFound} ${scoresFound === 1 ? 'score' : 'scores'} so far` : '')
      : `Checked ${shopsTotal} ${shopsWord(shopsTotal)}`
  }
  return {
    isSearching,
    isInterrupted: !isSearching && job?.state === 'interrupted',
    hasFailed: !isSearching && job?.state === 'failed',
    shopsDone,
    shopsTotal,
    scoresFound,
    metaLine,
    noneLine: shopsTotal > 0 ? `No critic scores found at ${shopsTotal} ${shopsWord(shopsTotal)}.` : 'No critic scores found.',
  }
}

export interface PriceSearch {
  isSearching: boolean
  /** The lookup failed, or stopped under the server: say so, with Retry. */
  hasFailed: boolean
}

export function priceSearchOf(wine: WineEntry, busy: boolean, error: string | null = null): PriceSearch {
  const job = priceJobOf(wine)
  const isSearching = busy || job?.state === 'running'
  return {
    isSearching,
    hasFailed: !isSearching && (!!error || job?.state === 'failed' || job?.state === 'interrupted'),
  }
}

/**
 * The fields a lookup writes, and nothing else. A poll brings these across and
 * leaves everything the developer owns (tags, quantity, notes, an identity edit
 * in progress) exactly as it is, because the poll may predate an edit made since.
 */
const ENRICHMENT_FIELDS = [
  'price_data',
  'review_data',
  'review_probe_log',
  'enrichment_job',
  'drinking_window',
  'drinking_window_source',
  'vintage_rating',
  'vintage_rating_source',
  'window_status',
  'critic_summary',
  'enrichment_stale',
  'price_exclusions',
  'review_ladder',
  'bottling_prompt',
  'bottling_answer',
  'price_window',
  'price_state',
  'enrichment_outcome',
] as const satisfies readonly (keyof WineEntry)[]

function enrichmentOf(wine: WineEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ENRICHMENT_FIELDS) out[key] = wine[key] ?? null
  return out
}

/** Whether two copies of a wine agree on everything a lookup writes. */
export function sameEnrichment(a: WineEntry, b: WineEntry): boolean {
  return JSON.stringify(enrichmentOf(a)) === JSON.stringify(enrichmentOf(b))
}

/** `current` with what a lookup writes taken from `fresh`. */
export function mergeEnrichment(current: WineEntry, fresh: WineEntry): WineEntry {
  const merged: WineEntry = { ...current }
  for (const key of ENRICHMENT_FIELDS) {
    // Assigned key by key: the fields have different types, and a field the
    // server left out of `fresh` is cleared, not kept.
    ;(merged as unknown as Record<string, unknown>)[key] = fresh[key]
  }
  return merged
}
