interface Props {
  onClick: () => void
  disabled?: boolean
}

/**
 * Hard refresh (Phase 12.1 D6, WI-7): `force=true`, bypassing the server's
 * freshness guard and the reviews probe memory. A bordered button of its own —
 * not a text link — because it spends credits. It replaces the old "Refresh
 * anyway" link on both Critic reviews and Price & retailers, and sits next to
 * that section's normal refresh. Phase 12.3 WI-1 took the credit figure off
 * the button: the developer knows what a hard refresh costs.
 */
export function HardRefreshButton({ onClick, disabled }: Props) {
  return (
    <button type="button" className="btn-hard-refresh" onClick={onClick} disabled={disabled}>
      Hard refresh
    </button>
  )
}
