import type { RetailerReview } from '@shared/types'
import { getDedupedCriticScores } from './criticScores'

// One distinct drinking window, carrying every publication that stated it.
// Grouped rather than listed per-citation so three critics agreeing on
// 2029–2045 read as one window with three names, not three identical rows.
export interface AttributedDrinkingWindow {
  start: number
  end: number
  publications: string[]
}

/**
 * The distinct drinking windows stated across a wine's critic citations, each
 * attributed to the publications that stated it.
 *
 * Completeness filter matches `deriveWineLevelFields`
 * (backend/modules/reviews/derive-wine-level.ts) exactly — both endpoints
 * required — so the UI's notion of "the critics disagree" is the same one that
 * produced the null wine-level field. A looser filter here (as in
 * CriticScoreBadges, which shows half-open windows) would let the UI claim
 * disagreement on citations the backend never considered.
 *
 * Scores are deduped by publication first, so one critic syndicated across
 * several retailers counts once rather than reading as agreement with itself.
 */
export function getAttributedDrinkingWindows(
  reviewData: RetailerReview[] | null | undefined
): AttributedDrinkingWindow[] {
  const grouped: AttributedDrinkingWindow[] = []

  for (const score of getDedupedCriticScores(reviewData)) {
    const w = score.drinking_window
    if (!w || w.start === null || w.end === null) continue

    const existing = grouped.find((g) => g.start === w.start && g.end === w.end)
    if (existing) {
      if (!existing.publications.includes(score.publication)) {
        existing.publications.push(score.publication)
      }
    } else {
      grouped.push({ start: w.start, end: w.end, publications: [score.publication] })
    }
  }

  return grouped
}
