import type { CriticScore } from '@shared/types'

// Same enum as vintage_rating (VintageRating), but this is a per-citation
// value from a single critic — not the wine-level, cross-critic-agreement
// field. Kept as its own label map since the two must never be conflated in
// copy (CLAUDE.md §15 non-blending rule).
const VINTAGE_CHARACTER_LABELS: Record<string, string> = {
  below_avg: 'Below-avg vintage',
  avg: 'Average vintage',
  good: 'Good vintage',
  very_good: 'Very good vintage',
}

interface Props {
  scores: CriticScore[]
}

/**
 * One badge per critic citation: the number, the source, and — when the
 * source text stated them — the per-citation coded attributes from Phase 8
 * (drinking window, vintage character, value/deal signal). Each of these
 * three is independently optional per citation; omitted entirely when the
 * source didn't state it, never inferred.
 */
export function CriticScoreBadges({ scores }: Props) {
  if (scores.length === 0) return null

  return (
    <div className="critic-scores">
      {scores.map((s, i) => (
        <span key={i} className="critic-score-badge">
          <span className="critic-score">{s.score}</span>
          <span className="critic-publication">{s.publication}</span>
          {s.drinking_window && (s.drinking_window.start != null || s.drinking_window.end != null) && (
            <span className="critic-attribute critic-drinking-window">
              Drink {s.drinking_window.start ?? '?'}–{s.drinking_window.end ?? '?'}
            </span>
          )}
          {s.vintage_character && (
            <span className="critic-attribute critic-vintage-character">
              {VINTAGE_CHARACTER_LABELS[s.vintage_character]}
            </span>
          )}
          {s.deal && <span className="critic-attribute critic-deal">Value pick</span>}
        </span>
      ))}
    </div>
  )
}
