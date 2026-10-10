import { creditsLabel, type HardRefreshKind } from '@shared/config/enrichment-costs.config'

interface Props {
  kind: HardRefreshKind
  onClick: () => void
  disabled?: boolean
}

/**
 * Hard refresh (Phase 12.1 D6, WI-7): `force=true`, bypassing the server's
 * freshness guard and the reviews probe memory. A bordered button of its own —
 * not a text link — because it spends credits, and it says how many. It
 * replaces the old "Refresh anyway" link on both Critic reviews and
 * Price & retailers, and sits next to that section's normal refresh.
 */
export function HardRefreshButton({ kind, onClick, disabled }: Props) {
  return (
    <button type="button" className="btn-hard-refresh" onClick={onClick} disabled={disabled}>
      Hard refresh
      <span className="btn-hard-refresh-cost"> · {creditsLabel(kind)}</span>
    </button>
  )
}
