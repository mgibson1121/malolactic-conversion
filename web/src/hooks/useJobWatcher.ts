import { useEffect, useRef } from 'react'
import type { WineEntry } from '@shared/types'
import { getWine } from '../api'
import { JOB_POLL_MS, JOB_WATCH_MAX_MS } from '../constants'
import { jobsRunning, mergeEnrichment, sameEnrichment } from '../utils/enrichmentJob'

/**
 * Follows a wine's running lookups by reading it, which is free, until the
 * server says they have ended (Phase 14 WI-6, spec §5.4). Mirrors the iOS
 * `EnrichmentWatcher`.
 *
 * The POST that starts a search stays open for the whole run, but the screen
 * must also show what that request cannot: the scores and the count so far,
 * and a search that is running when the request is not this screen's (a wine
 * saved mid-search, a request that dropped). The server saves each shop as it
 * finishes, so a plain GET shows them.
 *
 * Active while `requestOut` (this screen's own request is open) or the wine's
 * job is running. Never starts a search and never retries one. One watcher
 * follows a search for at most `JOB_WATCH_MAX_MS`.
 *
 * Only what a lookup writes is taken from a read (`mergeEnrichment`), and a
 * read that began before the wine last changed is dropped, so a slow poll can
 * never put an older answer over a newer one.
 */
export function useJobWatcher(wine: WineEntry, requestOut: boolean, onWine: (wine: WineEntry) => void): void {
  const active = requestOut || jobsRunning(wine)
  const wineRef = useRef(wine)
  wineRef.current = wine
  const onWineRef = useRef(onWine)
  onWineRef.current = onWine

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const began = Date.now()
    const timer = setInterval(async () => {
      if (Date.now() - began > JOB_WATCH_MAX_MS) {
        clearInterval(timer)
        return
      }
      const before = wineRef.current
      try {
        const fresh = await getWine(before.id)
        // Changed while the read was out, or this watcher is gone: drop it.
        if (cancelled || wineRef.current !== before) return
        if (!sameEnrichment(before, fresh)) onWineRef.current(mergeEnrichment(before, fresh))
      } catch {
        // A failed read is not the end of the search: try again next tick.
      }
    }, JOB_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, wine.id])
}
