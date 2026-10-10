import type { CriticSummary, CriticSummaryItem } from '@shared/types'
import { CRITIC_ABBREVIATIONS } from '@shared/config/critic-abbreviations.config'

export interface CardBadge {
  item: CriticSummaryItem
  /** `96` or `17.5`. */
  score: string
  /** `WA`, or the raw attribution (truncated) for an unrecognised source. */
  label: string
  /** `'18` — present only when the score's stated vintage is not the wine's. */
  yearTag: string | null
  /** False renders the badge with a dashed border. */
  known: boolean
  /** The `+N` suffix; 0 means none. */
  additional: number
}

const UNKNOWN_MAX_LENGTH = 12

/** `96`, or `17.5` on a 20-point scale. Numbers are never abbreviated. */
export function formatScore(score: number): string {
  return String(score)
}

export function labelFor(item: Pick<CriticSummaryItem, 'publication' | 'known_publication'>): string {
  if (item.known_publication) {
    const short = CRITIC_ABBREVIATIONS[item.publication]
    if (short) return short
  }
  const raw = item.publication
  return raw.length > UNKNOWN_MAX_LENGTH ? `${raw.slice(0, UNKNOWN_MAX_LENGTH)}…` : raw
}

export function yearTagOf(item: Pick<CriticSummaryItem, 'same_vintage' | 'vintage'>): string | null {
  if (item.same_vintage || item.vintage == null) return null
  return `'${String(item.vintage).slice(-2)}`
}

/**
 * The list-card badge: the first score in the backend's order (D13), with a
 * muted year tag when its page's vintage is not the wine's. Never averaged;
 * the rest are a `+N` that opens the detail view.
 */
export function cardBadge(summary: CriticSummary): CardBadge | null {
  const first = summary.ordered[0]
  if (!first) return null
  return {
    item: first,
    score: formatScore(first.score),
    label: labelFor(first),
    yearTag: yearTagOf(first),
    known: first.known_publication,
    additional: summary.ordered.length - 1,
  }
}
