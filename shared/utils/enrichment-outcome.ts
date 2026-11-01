import type { CriticSummary, EnrichmentOutcomes, LookupOutcome, PriceData, PriceWindow, RetailerReview } from '../types'

/**
 * What a stored lookup found, in one word per lookup (Phase 12.4 WI-7) —
 * derived on every read, so both clients state it the same way:
 *
 *   found         at least one counted price / one displayed critic score
 *   none_counted  listings or pages were found, none of them countable
 *   none_found    the search ran and nothing within the window came back
 *
 * `failed` is never derived from stored data: a request that errors or times
 * out stores nothing. It comes only from an error response (`outcome:
 * 'failed'` on the route's error body) or a client that lost the request —
 * and the iOS app re-reads the wine before saying so, because a lookup that
 * outlasts the phone's timeout still finishes and stores on the server
 * (the 2026-10-31 "lookup failed" for searches that had found nothing).
 *
 * Null means never looked up.
 */
export function priceOutcomeOf(priceData: PriceData | null | undefined, window: PriceWindow | null | undefined): LookupOutcome | null {
  if (!priceData) return null
  const shown = window ? priceData.retailers.filter(r => !window.hidden.includes(r.slug)) : priceData.retailers
  if (shown.length === 0) return 'none_found'
  // Counted: a headline exists, or the ambiguous split (counted, no single average).
  const counted = priceData.price_min != null || priceData.headline_basis === 'ambiguous'
  return counted ? 'found' : 'none_counted'
}

export function reviewsOutcomeOf(reviewData: RetailerReview[] | null | undefined, summary: CriticSummary): LookupOutcome | null {
  if (!reviewData) return null
  if (summary.ordered.length > 0) return 'found'
  return reviewData.length > 0 ? 'none_counted' : 'none_found'
}

export function enrichmentOutcomesOf(input: {
  price_data: PriceData | null | undefined
  price_window: PriceWindow | null | undefined
  review_data: RetailerReview[] | null | undefined
  critic_summary: CriticSummary
}): EnrichmentOutcomes {
  return {
    price: priceOutcomeOf(input.price_data, input.price_window),
    reviews: reviewsOutcomeOf(input.review_data, input.critic_summary),
  }
}
