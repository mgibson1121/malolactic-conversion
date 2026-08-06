import type { AttributedDrinkingWindow } from '../utils/drinkingWindows'

interface Props {
  windows: AttributedDrinkingWindow[]
}

/**
 * The per-critic drinking windows, shown where the wine-level summary field
 * would otherwise be — i.e. when critics disagree and `deriveWineLevelFields`
 * left `drinking_window` null.
 *
 * Every window carries its critic's name. Nothing here is reconciled into a
 * single range: no averaging, no outer bounds, no "most critics say" (CLAUDE.md
 * §15 — each data source speaks in its own voice). The wine-level field stays
 * null; this is the disagreement made visible, not a replacement value.
 *
 * Years are rendered raw, matching CriticScoreBadges. The wine-level field
 * stores ISO date strings instead, so the two displays read differently by
 * design — this one is per-critic, that one is the agreed summary.
 */
export function AttributedDrinkingWindows({ windows }: Props) {
  if (windows.length === 0) return null

  // Critics, not windows — several critics can share one window, so
  // windows.length would undercount who actually weighed in.
  const criticCount = windows.reduce((n, w) => n + w.publications.length, 0)

  return (
    <div className="attributed-drinking-windows">
      {windows.length > 1 && (
        <span className="attributed-drinking-windows-note">
          {criticCount} critics, {windows.length} different windows
        </span>
      )}
      <ul className="attributed-drinking-window-list">
        {windows.map((w, i) => (
          <li key={i} className="attributed-drinking-window">
            <span className="attributed-drinking-window-range">
              {w.start}–{w.end}
            </span>
            <span className="attributed-drinking-window-critics">
              {w.publications.join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
