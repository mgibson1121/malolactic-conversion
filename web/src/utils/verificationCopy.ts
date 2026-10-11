import type { RetailerPrice, VerificationState } from '@shared/types'

/**
 * What each badge on a retailer row means (Phase 12.1 WI-8). The wording
 * follows the `VerificationState` definition in shared/types.ts; if that
 * definition changes, this copy changes with it.
 *
 * Honest scope: "Verified" confirms the shop's own search page mentions the
 * producer. It says nothing about the vintage or the exact bottling — those
 * have their own badges.
 */
export type BadgeKind = 'verified' | 'unverified' | 'search_only'

export const BADGE_EXPLANATIONS: Record<BadgeKind, { title: string; text: string }> = {
  verified: {
    title: 'Verified',
    text:
      "We opened this shop's own search page and it mentions this producer. " +
      'That does not confirm the vintage or the exact bottling — those have their own badges.',
  },
  unverified: {
    title: 'Unverified',
    text:
      "We couldn't confirm this listing (the shop's page didn't load in time, or no producer is recorded). " +
      'The price is from Google Shopping and may be out of date.',
  },
  search_only: {
    title: 'Search only',
    text: 'A link to the shop’s search page; no price was found.',
  },
}

export function badgeKindOf(r: Pick<RetailerPrice, 'verification' | 'link_only'>): BadgeKind | null {
  if (r.link_only) return 'search_only'
  const v: VerificationState = r.verification
  if (v === 'verified') return 'verified'
  if (v === 'unverified') return 'unverified'
  return null // 'unchecked' shows no badge
}
