import { useState } from 'react'
import type { WineEntry } from '@shared/types'
import type { EnrichmentOptions, EnrichmentResponse } from '../api'

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
  failureMessage: string
): EnrichmentAction {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  async function run(opts?: EnrichmentOptions) {
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
      setError(err instanceof Error ? err.message : failureMessage)
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, cachedAt, run }
}
