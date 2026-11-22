import { useState } from 'react'
import type { WineEntry } from '@shared/types'
import { getWine, type EnrichmentOptions, type EnrichmentResponse } from '../api'
import type { JobKind } from '../utils/enrichmentJob'

/**
 * Drives one metered enrichment button (Phase 9.2, WI-4).
 *
 * WineCard and WineDetailModal both render the Fetch/Refresh Price and
 * Fetch/Refresh Reviews buttons, and before this each held its own copy of the
 * busy/error handling. The cached case adds a third piece of state to that, so
 * the duplication is extracted rather than tripled — the same bar CLAUDE.md §5
 * applies to backend modules: would a fix here need re-applying elsewhere?
 *
 * The button itself never forces. One click shows what is already stored; a
 * second, explicit click on "Refresh anyway" spends the credits.
 *
 * Phase 14 (WI-6): given `watch`, the action knows the wine's job on the
 * server. A request while that job is running is not sent (the server would
 * join it anyway, but the button should not look as if it started something),
 * and a request that fails while the server is still working is not an error:
 * the lookup carries on and `useJobWatcher` shows it.
 */
export interface EnrichmentAction {
  busy: boolean
  error: string | null
  /** When the server declined to re-fetch, when its stored data was sourced.
   * Null whenever the last run actually went out to the network. */
  cachedAt: string | null
  run: (opts?: EnrichmentOptions) => Promise<void>
}

export function useEnrichmentAction(
  wineId: string,
  fetcher: (id: string, opts?: EnrichmentOptions) => Promise<EnrichmentResponse>,
  onWineUpdated: (wine: WineEntry) => void,
  failureMessage: string,
  watch?: { wine: WineEntry; kind: JobKind }
): EnrichmentAction {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  /** The wine as the server has it, when the lookup this request was for is still running there. */
  async function stillRunning(): Promise<WineEntry | null> {
    if (!watch) return null
    try {
      const fresh = await getWine(wineId)
      return fresh.enrichment_job?.[watch.kind]?.state === 'running' ? fresh : null
    } catch {
      return null
    }
  }

  async function run(opts?: EnrichmentOptions) {
    if (!busy && watch?.wine.enrichment_job?.[watch.kind]?.state === 'running') return
    setBusy(true)
    setError(null)
    try {
      const response = await fetcher(wineId, opts)
      // A forced run always reaches the network, so it always clears the
      // notice — otherwise "Refresh anyway" would leave its own prompt on
      // screen after doing exactly what it was asked to.
      setCachedAt(response.cached ? response.fetched_at ?? null : null)
      onWineUpdated(response)
    } catch (err) {
      // The request can fail while the search does not (a dropped connection,
      // a locked phone): look at the stored wine before showing an error.
      const running = await stillRunning()
      if (running) onWineUpdated(running)
      else setError(err instanceof Error ? err.message : failureMessage)
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, cachedAt, run }
}
