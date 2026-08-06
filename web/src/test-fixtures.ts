import type { RetailerReview } from '@shared/types'

/**
 * The Phase 9.1 identity fields every RetailerReview carries (page_vintage,
 * vintage_gap, match). Spread into review_data fixtures whose subject is
 * something else entirely — critic-score rendering, retailer link handling —
 * so those tests state the wine identity they assume once, here, rather than
 * repeating a six-key verdict object at every call site.
 *
 * This is the ordinary case: right producer, right appellation, right year,
 * nothing recorded about the bottling. Tests that care about a wrong-vintage
 * or uncertain page should override the fields they exercise rather than
 * reach for a second constant.
 */
export const MATCHED_IDENTITY: Pick<RetailerReview, 'page_vintage' | 'vintage_gap' | 'match'> = {
  page_vintage: 2019,
  vintage_gap: 0,
  match: {
    producer: 'match',
    denomination: 'match',
    bottling: 'unknown',
    vintage: 'match',
    candidateVintage: 2019,
    vintageGap: 0,
  },
}
