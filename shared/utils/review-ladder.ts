import { TRUSTED_CRITICS } from '../config/trusted-critics.config'
import type { ReviewLadder, ReviewLadderPage, ReviewLadderRung, ReviewRung, ReviewTierId, RetailerReview } from '../types'
import { bottlingBadge, bottlingDifference, isExactBottling, type BottlingDifference, type BottlingWine } from './bottling-difference'

/** "Similar vintage" is one rule everywhere: ±3 years (Phase 12.2 D9). */
export const SIMILAR_VINTAGE_YEARS = 3

/**
 * What is *displayed* (Phase 12.4 WI-1, developer 2026-10-31): critic scores,
 * critic windows, price listings and the ladder's tier show only what is
 * within ±3 vintages of the wine. Display only — the pipeline still records
 * every gap and rejects nothing. A side with no stated vintage is never
 * outside (it can't be judged); an NV wine against a vintaged page neither.
 */
export function withinSimilarVintage(candidateVintage: number | null | undefined, wineVintage: number | null | undefined): boolean {
  if (candidateVintage == null || wineVintage == null) return true
  return Math.abs(candidateVintage - wineVintage) <= SIMILAR_VINTAGE_YEARS
}

const RUNG_ORDER: ReviewRung[] = ['1', '2', '3a', '3b', 'out']

export function isTrustedPublication(
  score: { publication: string; known_publication?: boolean },
  trusted: readonly string[] = TRUSTED_CRITICS
): boolean {
  return score.known_publication === true && trusted.some(t => t.toLowerCase() === score.publication.toLowerCase())
}

/** Years between a page's vintage and the wine's. 0 for an NV page against an NV wine; null when either is unstated. */
export function vintageDelta(pageVintage: number | null | undefined, wineVintage: number | null | undefined): number | null {
  if (wineVintage == null) return pageVintage == null ? 0 : null
  if (pageVintage == null) return null
  return Math.abs(pageVintage - wineVintage)
}

/** What a stored review page says about the wine's bottling, judged against the wine as it is *now*. */
export function reviewBottlingDifference(review: Pick<RetailerReview, 'product_url' | 'page_bottling'>, wine: BottlingWine): BottlingDifference {
  return bottlingDifference({ url: review.product_url, pageBottling: review.page_bottling ?? null }, wine)
}

/**
 * Which rung a page with scores sits on (spec WI-2.3, D9). Pure; the rung is
 * the page's own, the wine's tier is the first rung that holds a page.
 */
export function rungOf(args: { exact: boolean; delta: number | null; hasTrustedScore: boolean }): ReviewRung {
  const { exact, delta, hasTrustedScore } = args
  // Beyond ±3 years nothing is displayed (WI-1), so it can't set the tier.
  if (exact && delta != null && delta > SIMILAR_VINTAGE_YEARS) return 'out'
  if (exact) return delta === 0 && hasTrustedScore ? '1' : '2'
  if (delta === 0) return '3a'
  if (delta != null && delta <= SIMILAR_VINTAGE_YEARS) return '3b'
  return 'out'
}

/**
 * The review ladder for one wine (Phase 12.2 WI-2). Derived from the stored
 * pages and the wine's current identity — nothing stored — so answering "Which
 * bottling is yours?" re-scores every stored page with no network call and a
 * wine can climb back to Tier 1 or 2.
 *
 * Narrow first, widen one rung at a time, stop at the first rung that yields a
 * score. The ladder reports the best rung that has one; the fetch pipeline
 * (modules/reviews) is what declines to read wider rungs when a narrower one
 * is already healthy.
 */
export function buildReviewLadder(
  reviewData: RetailerReview[] | null | undefined,
  wine: BottlingWine,
  trusted: readonly string[] = TRUSTED_CRITICS
): ReviewLadder {
  const pages: ReviewLadderPage[] = []
  const byRung = new Map<ReviewRung, ReviewLadderRung>()

  for (const review of reviewData ?? []) {
    const scores = review.critic_scores ?? []
    const diff = reviewBottlingDifference(review, wine)
    const delta = vintageDelta(review.page_vintage, wine.vintage)
    const trustedScores = scores.filter(s => isTrustedPublication(s, trusted)).length
    const rung = scores.length === 0 ? null : rungOf({ exact: isExactBottling(diff), delta, hasTrustedScore: trustedScores > 0 })
    pages.push({
      slug: review.slug,
      name: review.name,
      product_url: review.product_url,
      rung,
      page_vintage: review.page_vintage ?? null,
      vintage_delta: delta,
      scores: scores.length,
      trusted_scores: trustedScores,
      badge: bottlingBadge(diff),
      tier_note: diff.tierNote,
    })
    if (rung === null) continue
    const entry = byRung.get(rung) ?? { tier: rung, pages: 0, scores: 0, trusted_scores: 0, critics: [], vintages: [] }
    entry.pages += 1
    entry.scores += scores.length
    entry.trusted_scores += trustedScores
    for (const s of scores) if (!entry.critics.includes(s.publication)) entry.critics.push(s.publication)
    if (review.page_vintage != null && !entry.vintages.includes(review.page_vintage)) entry.vintages.push(review.page_vintage)
    byRung.set(rung, entry)
  }

  const rungs = RUNG_ORDER.filter(r => byRung.has(r)).map(r => byRung.get(r)!)
  const best = rungs.find(r => r.tier !== 'out')
  const tier: ReviewTierId = best ? (best.tier as ReviewTierId) : 'none'
  return { tier, rungs, pages }
}

/** Order two rungs best-first. */
export function compareRungs(a: ReviewRung, b: ReviewRung): number {
  return RUNG_ORDER.indexOf(a) - RUNG_ORDER.indexOf(b)
}
