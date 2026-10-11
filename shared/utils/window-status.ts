import type { CriticDrinkingWindow, DrinkingWindow, RetailerReview, WindowStatus } from '../types'

/**
 * Whether a wine has a usable drinking window (Phase 12.1 WI-2). Computed
 * once, here, on every wine read — clients render the answer and never
 * re-derive it (the Swift app must not port this).
 *
 * - `primary` — the wine has a wine-level `drinking_window`: the developer's
 *   own, or the one derived from agreeing critics.
 * - `check`   — no wine-level window, and two or more critics state windows
 *   that disagree. This is exactly the situation `deriveWineLevelFields`
 *   resolves to null (backend/modules/reviews/derive-wine-level.ts), so it
 *   uses the same inputs: pages confirmed to be this vintage, both window
 *   endpoints present, one vote per publication.
 * - `none`    — no wine-level window and no disagreement to flag.
 *
 * A single critic's window is, by the existing rule, a derived primary
 * window — it never produces `check`. A `check` wine is never guessed at
 * from the per-critic windows (CLAUDE.md §15, non-blending).
 */
export function windowStatusOf(
  drinkingWindow: DrinkingWindow | null | undefined,
  reviewData: RetailerReview[] | null | undefined
): WindowStatus {
  if (drinkingWindow) return 'primary'
  return criticWindowsDisagree(reviewData) ? 'check' : 'none'
}

function criticWindowsDisagree(reviewData: RetailerReview[] | null | undefined): boolean {
  const seenPublications = new Set<string>()
  const distinct: CriticDrinkingWindow[] = []

  for (const review of reviewData ?? []) {
    // Same vintage gate as derivation: a page that never stated a year, or
    // stated another one, cannot establish this wine's window.
    if (review.match?.vintage !== 'match') continue
    for (const score of review.critic_scores ?? []) {
      const w = score.drinking_window
      if (!w || w.start == null || w.end == null) continue
      if (seenPublications.has(score.publication)) continue
      seenPublications.add(score.publication)
      if (!distinct.some((d) => d.start === w.start && d.end === w.end)) distinct.push(w)
    }
  }
  return distinct.length >= 2
}
