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
}

export const TIER_COPY: Record<Exclude<ReviewTierId, 'none'>, TierCopy> = {
  // Phase 12.5 WI-3: one short line on the marker, one sentence in the sheet
  // (plus the counts). Tier 1 shows the Exact match badge instead of a line.
  '1': {
    phrase: 'exact wine and vintage',
    meaning: 'A critic you trust scored this exact wine and vintage.',
  },
  '2': {
    phrase: 'other vintages',
    meaning: 'No trusted score for this vintage, so these are the same wine’s nearest vintages, within 3 years.',
  },
  '3': {
    phrase: 'different bottling',
    meaning: 'Nothing for this exact bottling, so these are a different bottling of the same producer and vintage.',
  },
  '4': {
    phrase: 'different bottling, other vintage',
    meaning: 'Nothing for this exact bottling, so these are a different bottling within 3 vintages — the loosest match.',
  },
}

export function tierHeadline(tier: ReviewTierId): string | null {
  return tier === 'none' ? null : `Tier ${tier} · ${TIER_COPY[tier].phrase}`
}

/** "Now matched at Tier 1 — 3 trusted scores" (the one-line result after an answer). */
export function tierResultLine(tier: ReviewTierId, scores: number, trustedScores: number): string {
  if (tier === 'none') return 'Saved. No scores for this bottling yet.'
  const n = trustedScores > 0 ? trustedScores : scores
  const kind = trustedScores > 0 ? 'trusted ' : ''
  return `Now matched at Tier ${tier} — ${n} ${kind}${n === 1 ? 'score' : 'scores'}`
}
