import type { ReviewTierId } from '@shared/types'

/**
 * What each review tier means, in the developer's terms (Phase 12.2 WI-2.3).
 * Seed copy from the spec. The tier itself is computed once, in the backend
 * (`review_ladder`); this is only the words.
 */
export interface TierCopy {
  /** The short phrase on the header marker. */
  phrase: string
  /** (a) what this tier means. */
  meaning: string
  /** (b) what it does to the card badge and drinking window. */
  effect: string
}

export const TIER_COPY: Record<Exclude<ReviewTierId, 'none'>, TierCopy> = {
  '1': {
    phrase: 'exact wine and vintage',
    meaning: 'We found a score for this exact wine and vintage from a critic we trust.',
    effect: 'The card badge and the drinking window come from these scores.',
  },
  '2': {
    phrase: 'same wine, other vintages',
    meaning:
      'No trusted score for this vintage, so we looked at other vintages of the same wine, nearest first. Scores and drinking windows from vintages within 3 years are used; further ones are shown for reference.',
    effect:
      'Scores within 3 vintages can set the card badge and the drinking window, labelled approximate. A critic’s window from further away is shown for reference and never merged into yours.',
  },
  '3': {
    phrase: 'different bottling, same vintage',
    meaning:
      'We found nothing for this exact bottling, so we widened to a different bottling of the same producer and vintage (for example a named vineyard or special cuvée). Treat these scores as a guide.',
    effect: 'The card badge is marked “from a different bottling” and the drinking window is approximate.',
  },
  '4': {
    phrase: 'different bottling, nearby vintage',
    meaning:
      'We found nothing for this exact bottling, so we widened to a different bottling of the same producer and then to a nearby vintage (within 3 years). This is the loosest match we make.',
    effect: 'The card badge is marked “from a different bottling” and the drinking window is approximate.',
  },
}

export function tierHeadline(tier: ReviewTierId): string | null {
  return tier === 'none' ? null : `Matched at Tier ${tier} · ${TIER_COPY[tier].phrase}`
}

/** "Now matched at Tier 1 — 3 trusted scores" (the one-line result after an answer). */
export function tierResultLine(tier: ReviewTierId, scores: number, trustedScores: number): string {
  if (tier === 'none') return 'Saved. Nothing found for this bottling yet; the wine has no matched scores.'
  const n = trustedScores > 0 ? trustedScores : scores
  const kind = trustedScores > 0 ? 'trusted ' : ''
  return `Now matched at Tier ${tier} — ${n} ${kind}${n === 1 ? 'score' : 'scores'}`
}
