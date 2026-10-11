import { TRUSTED_CRITICS } from '../config/trusted-critics.config'
import type { CriticSummary, CriticSummaryItem, RetailerReview } from '../types'
import { bottlingBadge, isExactBottling, type BottlingWine } from './bottling-difference'
import { reviewBottlingDifference, rungOf, vintageDelta } from './review-ladder'

/**
 * Orders a wine's critic scores by the developer's trusted-reviewer
 * preference, same vintage first (Phase 12.1 D13 / WI-10). Computed once, in
 * the backend, on every wine read; clients render the order they are given
 * and never re-sort — which is also why the scan preview cannot disagree
 * with the saved wine.
 *
 * Tiers:  1 same vintage + trusted · 2 same vintage · 3 trusted · 4 the rest.
 * Within a tier: highest score first; ties → known_publication first, then
 * source order. The first item is the list-card badge.
 *
 * "Same vintage" means the page *states* a vintage equal to the wine's; for
 * an NV wine, a page stating none counts as same. A page with no stated
 * vintage — and every blob stored before `page_vintage` existed — is
 * "vintage not stated": it sorts as not-same, carries no year tag, and is
 * not muted. Vintage ranks and labels but never rejects (CLAUDE.md §5).
 *
 * Dedupe is one entry per publication, applied *after* classification, so
 * a 2017 Wine Advocate score cannot hide a 2019 one.
 *
 * Ordering, not blending: nothing here averages anything, and every score
 * stays stored and visible on detail.
 */
export function buildCriticSummary(
  reviewData: RetailerReview[] | null | undefined,
  wineVintage: number | null | undefined,
  trusted: readonly string[] = TRUSTED_CRITICS,
  // Phase 12.2: when the wine is supplied, a page naming a different bottling
  // (an extra or a missing modifier, D8) sorts below every page of the exact
  // wine, nearest vintage first, and carries its rung and badge. Without it
  // the 12.1 ordering is unchanged.
  wine?: BottlingWine
): CriticSummary {
  const trustedSet = new Set(trusted.map((t) => t.toLowerCase()))
  const wineIsNv = wineVintage == null
  const items: Array<CriticSummaryItem & { order: number }> = []

  let order = 0
  for (const review of reviewData ?? []) {
    const pageVintage = review.page_vintage ?? null
    const sameVintage = wineIsNv ? pageVintage == null : pageVintage != null && pageVintage === wineVintage
    const diff = wine ? reviewBottlingDifference(review, wine) : null
    const exact = diff ? isExactBottling(diff) : true
    const delta = wine ? vintageDelta(pageVintage, wineVintage) : null
    const trustedOnPage = (review.critic_scores ?? []).some(
      (s) => s.known_publication === true && trustedSet.has(s.publication.toLowerCase())
    )
    for (const score of review.critic_scores ?? []) {
      const isTrusted = score.known_publication === true && trustedSet.has(score.publication.toLowerCase())
      items.push({
        publication: score.publication,
        score: score.score,
        vintage: pageVintage,
        same_vintage: sameVintage,
        trusted: isTrusted,
        tier: tierOf(sameVintage, isTrusted),
        known_publication: score.known_publication === true,
        drinking_window: score.drinking_window ?? null,
        vintage_character: score.vintage_character ?? null,
        deal: score.deal === true,
        ...(wine
          ? {
              rung: rungOf({ exact, delta, hasTrustedScore: trustedOnPage }),
              vintage_delta: delta,
              bottling_badge: diff ? bottlingBadge(diff) : null,
            }
          : {}),
        order: order++,
      })
    }
  }

  items.sort(compareItems)

  const seen = new Set<string>()
  const ordered: CriticSummaryItem[] = []
  for (const { order: _order, ...item } of items) {
    const key = item.publication.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    ordered.push(item)
  }
  return { ordered }
}

function tierOf(sameVintage: boolean, trusted: boolean): 1 | 2 | 3 | 4 {
  if (sameVintage) return trusted ? 1 : 2
  return trusted ? 3 : 4
}

function compareItems(a: CriticSummaryItem & { order: number }, b: CriticSummaryItem & { order: number }): number {
  // Different bottling after the exact wine; among those, the nearest vintage first.
  const aDiff = a.bottling_badge != null
  const bDiff = b.bottling_badge != null
  if (aDiff !== bDiff) return aDiff ? 1 : -1
  if (aDiff && bDiff) {
    const da = a.vintage_delta ?? Number.POSITIVE_INFINITY
    const db = b.vintage_delta ?? Number.POSITIVE_INFINITY
    if (da !== db) return da - db
  }
  if (a.tier !== b.tier) return a.tier - b.tier
  if (a.score !== b.score) return b.score - a.score
  if (a.known_publication !== b.known_publication) return a.known_publication ? -1 : 1
  return a.order - b.order
}
