import type { WineEntry } from '@shared/types'
import { attributedWindowsOfSummary } from '../utils/drinkingWindows'
import { criticSummaryOf, windowStatusOfWine } from '../utils/wineDerived'
import { AttributedDrinkingWindows } from './AttributedDrinkingWindows'

/**
 * The detail view's drinking window, in two visually distinct groups
 * (Phase 12.1 WI-2, D2):
 *
 *  1. The *primary* window — "Your window" when the developer set it, else
 *     "Window (from critics)" with the Sourced marker when it was derived from
 *     agreeing critics. Normal text style.
 *  2. "Critic windows (for reference)" — one row per window with its critics'
 *     names, muted, reference only. Shown whenever any exist, whether or not a
 *     primary window is set, so a manual window never hides what critics said.
 *
 * Nothing is blended: the primary window is the developer's or the unanimous
 * derived one, and the reference rows are the critics speaking for
 * themselves (CLAUDE.md §15).
 */
export function DrinkingWindowSection({ wine }: { wine: WineEntry }) {
  const status = windowStatusOfWine(wine)
  const reference = attributedWindowsOfSummary(criticSummaryOf(wine).ordered)
  if (!wine.drinking_window && reference.length === 0) return null

  return (
    <section className="detail-section">
      <h3 className="detail-section-title">Drinking Window</h3>

      {wine.drinking_window && (
        <div className="drinking-window-primary">
          <span className="detail-field-label">
            {wine.drinking_window_source === 'manual' ? 'Your window' : 'Window (from critics)'}
          </span>
          <p className="detail-drinking-window">
            {wine.drinking_window.start} – {wine.drinking_window.end}
            {wine.drinking_window_source === 'derived' && (
              <span className="badge-tier badge-tier--derived" title="From automated review extraction, not manually entered">Sourced</span>
            )}
          </p>
        </div>
      )}

      {status === 'check' && !wine.drinking_window && (
        <p className="detail-empty-hint">The critics disagree. Set your own window in Edit.</p>
      )}

      {reference.length > 0 && (
        <div className="critic-windows-reference">
          <span className="detail-field-label">
            Critic windows (for reference) <span className="reference-only">reference only</span>
          </span>
          <AttributedDrinkingWindows windows={reference} />
        </div>
      )}
    </section>
  )
}
