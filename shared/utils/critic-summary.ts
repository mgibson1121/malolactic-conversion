import { TRUSTED_CRITICS } from '../config/trusted-critics.config'
import type { CriticSummary, CriticSummaryItem, RetailerReview } from '../types'

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
  trusted: readonly string[] = TRUSTED_CRITICS
): CriticSummary {
  const trustedSet = new Set(trusted.map((t) => t.toLowerCase()))
  const wineIsNv = wineVintage == null
  const items: Array<CriticSummaryItem & { order: number }> = []

  let order = 0
  for (const review of reviewData ?? []) {
    const pageVintage = review.page_vintage ?? null
    const sameVintage = wineIsNv ? pageVintage == null : pageVintage != null && pageVintage === wineVintage
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
  if (a.tier !== b.tier) return a.tier - b.tier
  if (a.score !== b.score) return b.score - a.score
  if (a.known_publication !== b.known_publication) return a.known_publication ? -1 : 1
  return a.order - b.order
}
