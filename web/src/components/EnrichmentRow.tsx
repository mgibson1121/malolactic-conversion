import type { ReactNode } from 'react'
import type { HardRefreshKind } from '@shared/config/enrichment-costs.config'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { EnrichmentFreshness } from './EnrichmentFreshness'
import { HardRefreshButton } from './HardRefreshButton'

interface Props {
  kind: HardRefreshKind
  action: EnrichmentAction
  /** Shown on the normal button: "Fetch Reviews" / "Refresh Price & retailers". */
  label: string
  busyLabel: string
  /** Section name for the freshness line. */
  freshnessLabel: string
  /** Hard refresh needs data to refresh; shown once any exists (WI-7). */
  hasData: boolean
  /** Extra text under the buttons, e.g. "Searches 7 more shops". */
  note?: ReactNode
}

/**
 * The action row every enrichment section shares (Phase 12.1 WI-7): the
 * normal Fetch/Refresh button (unchanged behaviour — TTL-guarded, returns the
 * cached result when fresh), a separate bordered Hard refresh that states its
 * credit cost, the freshness line when a click returned stored data, and the
 * error.
 */
export function EnrichmentRow({ kind, action, label, busyLabel, freshnessLabel, hasData, note }: Props) {
  return (
    <div className="enrichment-row">
      <div className="enrichment-row-buttons">
        <button type="button" className="btn-fetch-price" onClick={() => action.run()} disabled={action.busy}>
          {action.busy ? busyLabel : label}
        </button>
        {hasData && <HardRefreshButton kind={kind} onClick={() => action.run({ force: true })} disabled={action.busy} />}
      </div>
      {note}
      {action.cachedAt && <EnrichmentFreshness fetchedAt={action.cachedAt} label={freshnessLabel} />}
      {action.error && <span className="price-error">{action.error}</span>}
    </div>
  )
}
