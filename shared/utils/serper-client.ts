/**
 * The one place an outbound Serper request is issued from (Phase 9.2,
 * 2026-08-12).
 *
 * Serper is billed per request, and it is the only dependency in this project
 * whose cost scales with *configuration* rather than with usage — adding a
 * retailer to RETAILER_CONFIG permanently raises the price of every future
 * enrichment (CLAUDE.md §15, "Metered-API cost is a design constraint"). Cost
 * that nobody can see is cost nobody decides on: per-wine review sourcing
 * reached ~38 credits across Phases 7.3–8 without anyone choosing it.
 *
 * So every call goes through here and is counted. Two counters, deliberately:
 *
 * - a per-request tally, opened by the route handler via
 *   `accountSerperUsage`, so one enrichment's spend is attributable to one
 *   wine without threading a counter through every function signature;
 * - a process-lifetime tally behind GET /api/debug/serper-usage.
 *
 * `attempts` is the billed number and `calls` is not: fetchWithRetry issues up
 * to three requests for one logical call, and a 429 storm — the most expensive
 * thing that can happen — is precisely where the two diverge.
 *
 * Lives in shared/ rather than in either module because both modules/price/
 * and modules/reviews/ need it and modules do not import each other
 * (CLAUDE.md §5), the same reasoning that put concurrency.ts here.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { fetchWithRetry } from './concurrency'

export type SerperEndpoint = 'search' | 'shopping'

export interface SerperCallRecord {
  endpoint: SerperEndpoint
  /** Attempts actually issued, including retries — this is what Serper bills. */
  attempts: number
  ok: boolean
  /** Free-text tag for attribution, e.g. 'reviews:primary:benchmark'. */
  label: string
}

export interface UsageCounts {
  /** Logical calls — one per serperFetch, however many attempts it took. */
  calls: number
  /** Requests actually issued. The billed figure. */
  attempts: number
  /** Calls that ended in a non-2xx response or a thrown error. */
  failed: number
  /**
   * Calls a cost guard prevented (Phase 9.2's WI-2/3/5).
   *
   * Recorded rather than merely not-happening, because "we stopped paying for
   * this" is the number that says whether the phase worked, and an absent call
   * leaves no trace to count.
   */
  avoided: number
}

export interface SerperUsage extends UsageCounts {
  by_label: Record<string, UsageCounts>
}

const SERPER_BASE = 'https://google.serper.dev'

/** How long a single Serper request may take before it is abandoned. Unchanged
 * from the per-module values this client replaced. */
const REQUEST_TIMEOUT_MS = 15_000

function emptyCounts(): UsageCounts {
  return { calls: 0, attempts: 0, failed: 0, avoided: 0 }
}

function emptyUsage(): SerperUsage {
  return { ...emptyCounts(), by_label: {} }
}

const requestScope = new AsyncLocalStorage<SerperUsage>()
let lifetime: SerperUsage = emptyUsage()

/** Applies `mutate` to both the lifetime tally and the current request's tally
 * (when a route opened one), for the totals and for the label's own row. */
function tally(label: string, mutate: (counts: UsageCounts) => void): void {
  for (const usage of [lifetime, requestScope.getStore()]) {
    if (!usage) continue
    mutate(usage)
    mutate((usage.by_label[label] ??= emptyCounts()))
  }
}

function record(rec: SerperCallRecord): void {
  tally(rec.label, counts => {
    counts.calls += 1
    counts.attempts += rec.attempts
    if (!rec.ok) counts.failed += 1
  })
}

/**
 * Records calls a cost guard prevented, so WI-1's report shows spend *avoided*
 * and not just spend incurred.
 *
 * `count` is the number of calls that would have been issued had the guard not
 * fired — for a skipped retailer that is the query-variant ladder it would
 * have burned, which is an estimate and is labelled as one. Never treat it as
 * billed; it is deliberately kept out of `attempts`.
 */
export function recordAvoidedCalls(label: string, count: number): void {
  if (count <= 0) return
  tally(label, counts => {
    counts.avoided += count
  })
}

/**
 * Issues one Serper request, records it, and returns the Response unchanged —
 * including error responses, so callers keep the "the request failed" vs "the
 * search ran and found nothing" distinction that Phase 9.1 was built on.
 */
export async function serperFetch(
  endpoint: SerperEndpoint,
  body: unknown,
  apiKey: string,
  label: string
): Promise<Response> {
  let attempts = 0
  try {
    const res = await fetchWithRetry(
      `${SERPER_BASE}/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
      { onAttempt: () => { attempts += 1 } }
    )
    record({ endpoint, attempts, ok: res.ok, label })
    return res
  } catch (err) {
    // A thrown request still cost whatever attempts reached Serper before it
    // gave up — dropping it here would under-report exactly the failures the
    // caller is being billed for.
    record({ endpoint, attempts, ok: false, label })
    throw err
  }
}

export interface UsageContext {
  wine_id: string
  action: string
}

/**
 * Opens a per-request accounting scope around one enrichment and logs its
 * total on the way out.
 *
 * The log line is emitted from `finally` on purpose: a run that threw is a run
 * that still spent money, and those are the ones worth seeing.
 */
export async function accountSerperUsage<T>(
  context: UsageContext,
  fn: () => Promise<T>
): Promise<T> {
  const usage = emptyUsage()
  try {
    return await requestScope.run(usage, fn)
  } finally {
    console.log(`[serper] ${JSON.stringify({ ...context, ...usage })}`)
  }
}

/** Process-lifetime totals, as a copy — GET /api/debug/serper-usage. */
export function getLifetimeUsage(): SerperUsage {
  return {
    ...lifetime,
    by_label: Object.fromEntries(
      Object.entries(lifetime.by_label).map(([label, counts]) => [label, { ...counts }])
    ),
  }
}

/** Clears the lifetime totals. For tests and for a manual before/after
 * measurement against the Serper dashboard — nothing in the app calls it. */
export function resetLifetimeUsage(): void {
  lifetime = emptyUsage()
}
