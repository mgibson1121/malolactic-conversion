import { getStorage } from '../modules/storage'
import type { EnrichmentJobs, UpdateWineInput, WineEntry } from '@shared/types'

/**
 * One job per wine per kind of lookup (Phase 14, WI-1).
 *
 * A metered lookup used to be a request: it began when the POST arrived, lived
 * inside that request, and was visible nowhere else. A search that outlived its
 * screen (a saved wine, a locked phone, a dropped connection) was invisible,
 * and a tap on the same wine started a second one. This registry is the
 * in-process half of the fix; `wines.enrichment_job` is the persisted half.
 *
 * It is not `coalesce` (enrichment-cache.ts), for two reasons that matter here:
 *
 * - `coalesce` is keyed by whatever string the caller builds, and the reviews
 *   route used to put the tier in it. A job here is keyed by wine and kind
 *   alone, so a scan's search, a Refresh tap and an old TestFlight build all
 *   attach to the one run.
 * - A coalesced run cannot be told to stop. A job can be cancelled (the wine
 *   was discarded, or its identity was edited), and cancelling removes it from
 *   the registry at once, so the request that follows an identity edit starts a
 *   new run instead of joining the old one's key until it finishes.
 *
 * The registry only knows what is running in this process. Whether a job
 * written `running` is still alive after a restart is `recoverInterruptedJobs`.
 */

export type JobKind = 'reviews' | 'price'
export type CancelReason = 'discarded' | 'superseded'
export type JobTier = 'primary' | 'full'

export interface JobHandle {
  readonly wineId: string
  readonly kind: JobKind
  /** `primary` only for a stale client that asks for it (spec D8). */
  readonly tier: JobTier
  /** The identityKey the run was started for. */
  readonly identity: string
  readonly startedAt: string
  /** Why the run was cancelled, or null while it is still wanted. */
  cancelled(): CancelReason | null
  /** Settles, never rejects, when the run has ended, however it ended. */
  readonly settled: Promise<void>
}

interface Entry {
  handle: JobHandle
  promise: Promise<unknown>
  reason: CancelReason | null
}

const running = new Map<string, Entry>()

const keyOf = (wineId: string, kind: JobKind) => `${wineId}:${kind}`

export interface StartedJob<T> {
  promise: Promise<T>
  handle: JobHandle
  /** True when this call attached to a run already under way. */
  joined: boolean
}

/**
 * Runs `run`, or attaches to the job already running for this wine and kind.
 * An attached caller gets the same outcome as the caller that started it,
 * including its failure, as with `coalesce`.
 *
 * `run` receives the handle so each step can ask whether it is still wanted
 * before writing: a result for a discarded wine, or for an identity the wine no
 * longer has, must be dropped, never stamped onto the wrong wine.
 */
export function startOrJoin<T>(
  wineId: string,
  kind: JobKind,
  meta: { tier: JobTier; identity: string },
  run: (handle: JobHandle) => Promise<T>
): StartedJob<T> {
  const key = keyOf(wineId, kind)
  const existing = running.get(key)
  if (existing) return { promise: existing.promise as Promise<T>, handle: existing.handle, joined: true }

  let resolveSettled!: () => void
  const entry: Entry = {
    reason: null,
    promise: undefined as unknown as Promise<unknown>,
    handle: {
      wineId,
      kind,
      tier: meta.tier,
      identity: meta.identity,
      startedAt: new Date().toISOString(),
      cancelled: () => entry.reason,
      settled: new Promise<void>((resolve) => {
        resolveSettled = resolve
      }),
    },
  }

  entry.promise = run(entry.handle).finally(() => {
    // Only this run's own entry: after a cancel the key may already belong to a
    // newer run.
    if (running.get(key) === entry) running.delete(key)
    resolveSettled()
  })
  // The caller awaits `promise`; this stops a run nobody joined from being an
  // unhandled rejection on top of that.
  entry.promise.catch(() => {})
  running.set(key, entry)
  return { promise: entry.promise as Promise<T>, handle: entry.handle, joined: false }
}

/** The job running for this wine and kind in this process, if any. */
export function runningJob(wineId: string, kind: JobKind): JobHandle | undefined {
  return running.get(keyOf(wineId, kind))?.handle
}

/**
 * Cancels every job running for a wine. The run itself carries on until its
 * next check (a request already out cannot be recalled), but it is no longer
 * in the registry, so a new request starts fresh, and the run's own checks see
 * `cancelled()` and drop their results. Returns the kinds cancelled.
 */
export function cancelJobs(wineId: string, reason: CancelReason): JobKind[] {
  const cancelled: JobKind[] = []
  for (const kind of ['reviews', 'price'] as const) {
    const key = keyOf(wineId, kind)
    const entry = running.get(key)
    if (!entry) continue
    entry.reason = reason
    running.delete(key)
    cancelled.push(kind)
  }
  return cancelled
}

/** Runs currently registered: for tests and, later, the SIGTERM wait (WI-3). */
export function activeJobCount(): number {
  return running.size
}

// ── Persisted state ──────────────────────────────────────────────────────────

/**
 * Writes one section of `wines.enrichment_job`, leaving the other kind as it
 * is, together with any other fields the same write carries. Returns null when
 * the wine no longer exists (discarded, or a stale draft swept) so a caller can
 * treat that as "stop", never as an error.
 */
export async function writeJob<K extends JobKind>(
  wineId: string,
  kind: K,
  job: NonNullable<EnrichmentJobs[K]> | null,
  alongside: UpdateWineInput = {}
): Promise<WineEntry | null> {
  const storage = getStorage()
  const current = await storage.getWine(wineId)
  if (!current) return null
  return storage.updateWine(wineId, {
    ...alongside,
    enrichment_job: { ...(current.enrichment_job ?? {}), [kind]: job },
  })
}

/**
 * The server has just started, so nothing is running in this process: a job
 * the database still calls `running` belongs to a machine that was stopped
 * (Fly's idle stop, a deploy, a crash). Mark it `interrupted` rather than
 * leave a client watching a search that no longer exists. WI-3 adds the
 * heartbeat that catches the same thing without a restart, and the resume.
 */
export async function recoverInterruptedJobs(): Promise<number> {
  const storage = getStorage()
  const now = new Date().toISOString()
  let recovered = 0
  for (const wine of await storage.listWines({ include_drafts: true })) {
    const jobs = wine.enrichment_job
    if (!jobs) continue
    const next: EnrichmentJobs = { ...jobs }
    let changed = false
    for (const kind of ['reviews', 'price'] as const) {
      const job = jobs[kind]
      if (job?.state === 'running') {
        ;(next as Record<string, unknown>)[kind] = { ...job, state: 'interrupted', updated_at: now }
        changed = true
      }
    }
    if (!changed) continue
    await storage.updateWine(wine.id, { enrichment_job: next })
    recovered++
  }
  return recovered
}
