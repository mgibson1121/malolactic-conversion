import { useState } from 'react'
import type { CriticSummaryItem, WineEntry } from '@shared/types'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { criticSummaryOf, ladderOf, staleOf } from '../utils/wineDerived'
import { reviewSearchOf } from '../utils/enrichmentJob'
import { formatScore, yearTagOf } from '../utils/criticBadge'
import { TIER_COPY, tierHeadline } from '../utils/tierCopy'
import { BottlingBanner } from './BottlingPrompt'
import { ExactMatchBadge } from './PriceSection'
import { Sheet } from './Sheet'

interface Props {
  wine: WineEntry
  /** The reviews enrichment action — drives the Looking and Failed states. */
  action: EnrichmentAction
  /** A fresh scan whose lookup is already under way: until a result or an
   * error arrives, the block reads as Looking rather than idle. */
  lookupUnderWay?: boolean
  /** Enables "Which bottling is yours?" (Phase 12.2), which saves the answer. */
  onWineUpdated?: (wine: WineEntry) => void
  /** The scan's draft review (DiscoveryReview) rather than a saved wine. */
  draft?: boolean
}

export type CriticReviewsState = 'looking' | 'found' | 'none' | 'failed' | 'idle'

/**
 * Phase 12.1 WI-4: the critic block has explicit states and never vanishes
 * (this supersedes the Phase 12 implementation spec §6.4 "the block
 * disappears rather than showing an empty state mid-task" — that rule made
 * "still loading" and "found nothing" indistinguishable).
 *
 * Phase 14 (WI-6): a search that is running is shown as running whatever else
 * is known (spec D4). `looking` is a search with nothing to show yet; `found`
 * while a search is still going keeps its scores and adds the skeleton under
 * them, so the first score never reads as the end of the search. A saved wine
 * mid-search reads as looking, never as `idle`.
 *
 * `idle` is the one non-spec state: a wine whose scores have simply never been
 * looked up (manual add, no auto-fire). It says so rather than claiming a
 * search came back empty.
 */
export function criticReviewsState(wine: WineEntry, action: EnrichmentAction, lookupUnderWay = false): CriticReviewsState {
  const hasScores = criticSummaryOf(wine).ordered.length > 0
  if (hasScores) return 'found'
  const search = reviewSearchOf(wine, action.busy)
  if (search.isSearching) return 'looking'
  if (action.error || search.isInterrupted || search.hasFailed) return 'failed'
  if (wine.review_data) return 'none'
  return lookupUnderWay ? 'looking' : 'idle'
}

export function CriticReviewsBlock({ wine, action, lookupUnderWay, onWineUpdated, draft = false }: Props) {
  const state = criticReviewsState(wine, action, lookupUnderWay)
  const search = reviewSearchOf(wine, action.busy)
  const [promptOpen, setPromptOpen] = useState(false)
  const [tierOpen, setTierOpen] = useState(false)
  const stale = staleOf(wine).reviews
  const ladder = ladderOf(wine)

  return (
    <div className="critic-reviews-block" data-state={state}>
      {stale && (
        <p className="stale-notice">Found for an earlier version of this wine. Refresh.</p>
      )}

      {state === 'looking' && <SearchSkeleton line={search.metaLine ?? 'Checking reviews…'} />}

      {state === 'failed' && (
        <p className="critic-reviews-failed">
          {search.isInterrupted ? 'The search stopped before every shop was checked.' : 'Couldn’t check reviews.'}{' '}
          <button type="button" className="btn-link-inline" onClick={() => action.run()}>
            Retry
          </button>
        </p>
      )}

      {state === 'none' && (
        // How hard it looked, and nothing to click: the search already covered every shop.
        <div className="critic-reviews-none">
          <p>
            <strong>{search.noneLine}</strong>
          </p>
        </div>
      )}

      {state === 'idle' && <p className="detail-empty-hint">Critic scores haven’t been looked up yet.</p>}

      <ScorelessPages wine={wine} />

      {/* The tier is not announced while shops are unfinished: the best one so far is not the answer. */}
      {state === 'found' && search.isSearching && ladder?.tier !== '1' && (
        <p className="tier-marker tier-marker--quiet" data-testid="tier-looking">Looking for an exact-vintage score…</p>
      )}

      {state === 'found' && !search.isSearching && ladder && ladder.tier !== 'none' && (
        <TierMarker wine={wine} open={tierOpen} onOpenChange={setTierOpen} onChoose={onWineUpdated ? () => { setTierOpen(false); setPromptOpen(true) } : undefined} />
      )}

      {state === 'found' && <FoundScores wine={wine} />}

      {/* Scores above a skeleton and one line, until the last shop is in. */}
      {state === 'found' && search.isSearching && <SearchSkeleton line={search.metaLine ?? 'Searching shops…'} />}
      {state === 'found' && !search.isSearching && search.metaLine && (
        <p className="search-meta-line" data-testid="search-meta">{search.metaLine}</p>
      )}

      {/* A partial result never prompts a question: the banner waits for the search to end. */}
      {onWineUpdated && !search.isSearching && (
        <BottlingBanner wine={wine} onWineUpdated={onWineUpdated} open={promptOpen} onOpenChange={setPromptOpen} draft={draft} />
      )}
    </div>
  )
}

/**
 * Every score the wine has, never collapsed (Phase 12.5 WI-3, developer
 * 2026-10-31), in the backend's order — trusted critics first, same vintage
 * first. One compact line each: score, critic, and the year when it is not
 * the wine's. A "different bottling" tag only on a Tier 3/4 row. No per-row
 * explanation: drinking windows have their own section.
 */
function FoundScores({ wine }: { wine: WineEntry }) {
  const ordered = criticSummaryOf(wine).ordered
  return (
    <ul className="critic-score-lines" data-testid="critic-score-lines">
      {ordered.map((s) => (
        <ScoreLine key={s.publication} s={s} />
      ))}
    </ul>
  )
}

function ScoreLine({ s }: { s: CriticSummaryItem }) {
  const differentBottling = s.rung === '3' || s.rung === '4'
  return (
    <li className={`critic-score-line${s.same_vintage ? '' : ' critic-score-line--other'}`}>
      <span className="critic-score">{formatScore(s.score)}</span>
      <span className="critic-publication">{s.publication}</span>
      {yearTagOf(s) && (
        <span className="critic-attribute critic-year-tag" title="The vintage this score is for">
          {s.vintage}
        </span>
      )}
      {differentBottling && s.bottling_badge && (
        <span className="critic-attribute critic-different-bottling" title={s.bottling_badge}>
          different bottling
        </span>
      )}
    </li>
  )
}

/**
 * The header marker (Phase 12.2 WI-2.3): "Matched at Tier 2 · same wine, other
 * vintages ⓘ". The ⓘ is underlined and tappable (the 12.1 link rule) and opens
 * a sheet that says what the tier means, what it does to the badge and the
 * window, and what was found at each rung. Tier 1 shows it too, quietly.
 */
function TierMarker({
  wine,
  open,
  onOpenChange,
  onChoose,
}: {
  wine: WineEntry
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose?: () => void
}) {
  const ladder = ladderOf(wine)!
  const tier = ladder.tier
  if (tier === 'none') return null
  const copy = TIER_COPY[tier]
  const quiet = tier === '1'
  return (
    <>
      <p className={`tier-marker${quiet ? ' tier-marker--quiet' : ''}`} data-testid="tier-marker">
        {/* Phase 12.5 WI-3/WI-4: Tier 1 is the Exact match badge; the others one short line. */}
        {tier === '1' ? <ExactMatchBadge /> : tierHeadline(tier)}{' '}
        <button type="button" className="link info-badge" aria-label="What does this tier mean?" onClick={() => onOpenChange(true)}>
          ⓘ
        </button>
      </p>
      {open && (
        <Sheet title={`Tier ${tier}`} onClose={() => onOpenChange(false)}>
          <p>{copy.meaning}</p>
          <h4 className="sheet-subtitle">What was found</h4>
          <ul className="tier-rungs">
            {ladder.rungs.map((r) => (
              <li key={r.tier}>
                <strong>Tier {r.tier}</strong>: {r.pages} {r.pages === 1 ? 'page' : 'pages'}, {r.scores}{' '}
                {r.scores === 1 ? 'score' : 'scores'}
                {r.critics.length > 0 && ` (${r.critics.join(', ')})`}
                {r.vintages.length > 0 && ` · vintages ${[...r.vintages].sort().join(', ')}`}
              </li>
            ))}
          </ul>
          {(tier === '3' || tier === '4') && onChoose && (
            <button type="button" className="btn-secondary" onClick={onChoose}>
              Which bottling is yours?
            </button>
          )}
        </Sheet>
      )}
    </>
  )
}

/**
 * Pages that were found but gave no score (Phase 12.2 WI-5). Silence here read
 * as "nothing found" when the shop's page existed and the review on it was not
 * a number we can store (numbers only — the copyright boundary) or could not be
 * read. Says which page, with a link, so the developer can look.
 */
function ScorelessPages({ wine }: { wine: WineEntry }) {
  const pages = (ladderOf(wine)?.pages ?? []).filter((p) => p.scores === 0)
  if (pages.length === 0) return null
  return (
    <p className="scoreless-pages" data-testid="scoreless-pages">
      {pages.length === 1 ? 'A page with no readable score: ' : 'Pages with no readable score: '}
      {pages.map((p, i) => (
        <span key={p.product_url}>
          {i > 0 && ', '}
          <a className="link" href={p.product_url} target="_blank" rel="noreferrer">
            {p.name}
            {p.page_vintage ? ` (${p.page_vintage})` : ''}
          </a>
        </span>
      ))}
    </p>
  )
}

/**
 * Grey placeholder lines and one line saying how far the search has got. Shown
 * under any scores already in while a shop is still unfinished (Phase 14 D4).
 */
function SearchSkeleton({ line }: { line: string }) {
  return (
    <div className="critic-reviews-looking" role="status">
      <span className="skeleton-line" aria-hidden="true" />
      <span className="skeleton-line skeleton-line--short" aria-hidden="true" />
      <span className="critic-reviews-looking-text">{line}</span>
    </div>
  )
}
