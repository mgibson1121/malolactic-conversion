import { identityKey } from './wine-match'
import type { PriceData, RetailerReview } from '../types'

/**
 * Whether stored enrichment was fetched for a different version of the wine
 * (Phase 12.1 WI-1). A fetch stamps `enriched_for` (the identity key at that
 * moment) on price_data and on each review_data entry. When the wine's
 * identity is later edited and the developer declines "Refresh searches now?",
 * the old data stays and this reports it as stale so the UI can say so.
 *
 * A blob with no stamp is *unknown*, never stale: everything stored before
 * this phase is unstamped, and flagging it would mark the whole collection
 * (see "Stored enrichment JSON is older than its types", Phase 12 build log).
 */
export function enrichmentStale(wine: {
  producer?: string | null
  denomination?: string | null
  vintage?: number | null
  cuvee?: string | null
  vineyard?: string | null
  quality_classification?: string | null
  price_data?: Pick<PriceData, 'enriched_for'> | null
  review_data?: Array<Pick<RetailerReview, 'enriched_for'>> | null
}): { price: boolean; reviews: boolean } {
  const current = identityKey(wine)
  const differs = (stamp: string | undefined) => stamp !== undefined && stamp !== current
  return {
    price: differs(wine.price_data?.enriched_for),
    reviews: (wine.review_data ?? []).some((r) => differs(r.enriched_for)),
  }
}
