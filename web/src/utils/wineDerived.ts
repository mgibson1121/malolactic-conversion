import type { CriticSummary, PriceExclusions, ReviewLadder, WindowStatus, WineEntry } from '@shared/types'
import { buildCriticSummary } from '@shared/utils/critic-summary'
import { describePriceExclusions } from '@shared/utils/price-exclusions'
import { enrichmentStale } from '@shared/utils/enrichment-stale'
import { normalizeLadder } from '@shared/utils/review-ladder'
import { windowStatusOf } from '@shared/utils/window-status'

/**
 * The backend computes these on every wine read (Phase 12.1) and the web
 * renders what it is given. The fallbacks below run the *same shared
 * functions* — not a second definition — so a response from a backend that
 * has not been restarted since the update still renders correctly instead of
 * silently showing "no scores" and "no window".
 */

export function criticSummaryOf(wine: Pick<WineEntry, 'critic_summary' | 'review_data' | 'vintage'>): CriticSummary {
  return wine.critic_summary ?? buildCriticSummary(wine.review_data, wine.vintage)
}

export function windowStatusOfWine(wine: Pick<WineEntry, 'window_status' | 'drinking_window' | 'review_data'>): WindowStatus {
  return wine.window_status ?? windowStatusOf(wine.drinking_window, wine.review_data)
}

export function staleOf(wine: WineEntry): { price: boolean; reviews: boolean } {
  return wine.enrichment_stale ?? enrichmentStale(wine)
}

export function priceExclusionsOf(wine: Pick<WineEntry, 'price_exclusions' | 'price_data'>): PriceExclusions | null {
  return wine.price_exclusions !== undefined ? wine.price_exclusions : describePriceExclusions(wine.price_data)
}

/** The review ladder, with tiers under their Phase 12.3 names ('3a'/'3b' from an older backend read as 3/4). */
export function ladderOf(wine: Pick<WineEntry, 'review_ladder'>): ReviewLadder | null {
  return wine.review_ladder ? normalizeLadder(wine.review_ladder) : null
}
