import { useState } from 'react'
import type { CriticSummaryItem, VintageRating, WineEntry } from '@shared/types'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { criticSummaryOf, staleOf } from '../utils/wineDerived'
import { formatScore, yearTagOf } from '../utils/criticBadge'

const VINTAGE_CHARACTER_LABELS: Record<VintageRating, string> = {
  below_avg: 'Below-avg vintage',
  avg: 'Average vintage',
  good: 'Good vintage',
  very_good: 'Very good vintage',
}

/** Detail is never truncated beyond this: the first N, then "Show all". */
const VISIBLE_SCORES = 6

interface Props {
  wine: WineEntry
  /** The reviews enrichment action — drives the Looking and Failed states. */
  action: EnrichmentAction
  /** A fresh scan whose primary-tier lookup is already under way: until a
   * result or an error arrives, the block reads as Looking rather than idle. */
  lookupUnderWay?: boolean
  /** Offered in the "nothing found" state — the extended-tier search. */
  onSearchMore?: () => void
  extendedRetailerCount?: number
}

export type CriticReviewsState = 'looking' | 'found' | 'none' | 'failed' | 'idle'

/**
 * Phase 12.1 WI-4: the critic block has four explicit states and never
 * vanishes (this supersedes the Phase 12 implementation spec §6.4 "the block
 * disappears rather than showing an empty state mid-task" — that rule made
 * "still loading" and "found nothing" indistinguishable).
 *
 * `idle` is the one non-spec state: a wine whose scores have simply never been
 * looked up (manual add, no auto-fire). It says so rather than claiming a
 * search came back empty.
 */
export function criticReviewsState(wine: WineEntry, action: EnrichmentAction, lookupUnderWay = false): CriticReviewsState {
  const hasScores = criticSummaryOf(wine).ordered.length > 0
  if (hasScores) return 'found'
  if (action.busy) return 'looking'
  if (action.error) return 'failed'
  if (wine.review_data) return 'none'
  return lookupUnderWay ? 'looking' : 'idle'
}

export function CriticReviewsBlock({ wine, action, lookupUnderWay, onSearchMore, extendedRetailerCount }: Props) {
  const state = criticReviewsState(wine, action, lookupUnderWay)
  const [showAll, setShowAll] = useState(false)
  const stale = staleOf(wine).reviews

  return (
    <div className="critic-reviews-block" data-state={state}>
      {stale && (
        <p className="stale-notice">Fetched for a different version of this wine — may not match. Refresh.</p>
      )}

      {state === 'looking' && (
        <div className="critic-reviews-looking" role="status">
          <span className="skeleton-line" aria-hidden="true" />
          <span className="skeleton-line skeleton-line--short" aria-hidden="true" />
          <span className="critic-reviews-looking-text">Looking for critic scores…</span>
        </div>
      )}

      {state === 'failed' && (
        <p className="critic-reviews-failed">
          Review lookup failed —{' '}
          <button type="button" className="btn-link-inline" onClick={() => action.run()}>
            Try again
          </button>
        </p>
      )}

      {state === 'none' && (
        <div className="critic-reviews-none">
          <p>
            <strong>No critic scores found yet</strong> for this wine.
          </p>
          {onSearchMore && (
            <button type="button" className="btn-link-inline" onClick={onSearchMore} disabled={action.busy}>
              Search more retailers
            </button>
          )}
          {onSearchMore && extendedRetailerCount ? (
            <span className="scan-result-tier2"> Searches {extendedRetailerCount} more shops</span>
          ) : null}
        </div>
      )}

      {state === 'idle' && <p className="detail-empty-hint">Critic scores haven’t been looked up yet.</p>}

      {state === 'found' && <FoundScores wine={wine} showAll={showAll} onShowAll={() => setShowAll(true)} />}
    </div>
  )
}

function FoundScores({ wine, showAll, onShowAll }: { wine: WineEntry; showAll: boolean; onShowAll: () => void }) {
  const ordered = criticSummaryOf(wine).ordered
  const shown = showAll ? ordered : ordered.slice(0, VISIBLE_SCORES)
  const same = shown.filter((i) => i.same_vintage)
  const other = shown.filter((i) => !i.same_vintage)
  const nv = wine.vintage == null

  return (
    <div className="critic-scores-groups">
      {same.length > 0 && (
        <ScoreGroup title={nv ? 'This wine' : `Your vintage (${wine.vintage})`} items={same} />
      )}
      {other.length > 0 && <ScoreGroup title="Other vintages" items={other} />}
      {!showAll && ordered.length > VISIBLE_SCORES && (
        <button type="button" className="btn-link-inline" onClick={onShowAll}>
          Show all ({ordered.length})
        </button>
      )}
    </div>
  )
}

function ScoreGroup({ title, items }: { title: string; items: CriticSummaryItem[] }) {
  return (
    <div className="critic-score-group">
      <h4 className="critic-score-group-title">{title}</h4>
      <div className="critic-scores">
        {items.map((s) => (
          <span key={s.publication} className={`critic-score-badge${s.same_vintage ? '' : ' critic-score-badge--other'}`}>
            <span className="critic-score">{formatScore(s.score)}</span>
            <span className="critic-publication">{s.publication}</span>
            {s.trusted && (
              <span className="critic-attribute critic-trusted" title="One of your trusted critics">Trusted</span>
            )}
            {yearTagOf(s) && (
              <span className="critic-attribute critic-year-tag" title="The vintage this score is for">
                {s.vintage}
              </span>
            )}
            {s.drinking_window && (s.drinking_window.start != null || s.drinking_window.end != null) && (
              <span className="critic-attribute critic-drinking-window">
                Drink {s.drinking_window.start ?? '?'}–{s.drinking_window.end ?? '?'}
              </span>
            )}
            {s.vintage_character && (
              <span className="critic-attribute critic-vintage-character">{VINTAGE_CHARACTER_LABELS[s.vintage_character]}</span>
            )}
            {s.deal && <span className="critic-attribute critic-deal">Value pick</span>}
          </span>
        ))}
      </div>
    </div>
  )
}
