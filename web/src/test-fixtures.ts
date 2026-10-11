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
export const MATCHED_IDENTITY: Pick<RetailerReview, 'page_vintage' | 'vintage_gap' | 'match' | 'page_price'> = {
  page_vintage: 2019,
  vintage_gap: 0,
  page_price: null,
  match: {
    producer: 'match',
    denomination: 'match',
    bottling: 'unknown',
    vintage: 'match',
    candidateVintage: 2019,
    vintageGap: 0,
  },
}

import type { CriticSummaryItem, PriceData, RetailerPrice, WineEntry } from '@shared/types'

/** A complete WineEntry for tests that care about one thing. */
export function makeTestWine(overrides: Partial<WineEntry> = {}): WineEntry {
  return {
    id: 'wine-1',
    producer: 'Domaine Leroy',
    denomination: 'Gevrey-Chambertin',
    vintage: 2019,
    region: 'Burgundy',
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    grape_varieties: null,
    wine_color: 'red',
    label_image_url: null,
    tag_discovered: false,
    tag_wishlist: false,
    tag_cellar: true,
    tag_consumed: false,
    cellar_quantity: 3,
    cellar_category: null,
    drinking_window: null,
    drinking_window_source: null,
    vintage_rating: null,
    vintage_rating_source: null,
    my_rating: null,
    my_tags: [],
    latest_tasting_note_id: null,
    wishlist_notes: null,
    price_paid: null,
    manual_price: null,
    purchased_from: null,
    advice_linked: null,
    expert_reviews: null,
    community_sentiment: null,
    community_excerpts: null,
    price_data: null,
    retailer_links: null,
    review_data: null,
    review_probe_log: null,
    date_added: '2026-10-01T00:00:00.000Z',
    date_first_consumed: null,
    promoted_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeTestRetailer(overrides: Partial<RetailerPrice> = {}): RetailerPrice {
  return {
    slug: 'zachys',
    name: 'Zachys',
    price: 120,
    url: 'https://www.zachys.com/p/1',
    distance_miles: 12,
    is_preferred_retailer: true,
    is_search_results_page: false,
    matched_vintage: 2019,
    vintage_mismatch: false,
    vintage_verdict: 'match',
    pack_quantity: 1,
    bottle_size_ml: null,
    non_standard_format: false,
    format_label: '',
    link_only: false,
    verification: 'verified',
    ...overrides,
  }
}

export function makeTestPriceData(retailers: RetailerPrice[], overrides: Partial<PriceData> = {}): PriceData {
  const priced = retailers.filter((r) => r.price != null && !r.vintage_mismatch && (!r.non_standard_format || !!r.normalized) && !r.link_only)
  const prices = priced.map((r) => (r.price_per_750 ?? r.price) as number)
  return {
    price_min: prices.length ? Math.min(...prices) : null,
    price_avg: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
    price_max: prices.length ? Math.max(...prices) : null,
    other_vintage_price_range: null,
    retailers,
    nearest_retailer: priced[0] ?? null,
    fetched_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeSummaryItem(overrides: Partial<CriticSummaryItem> = {}): CriticSummaryItem {
  return {
    publication: 'Vinous',
    score: 93,
    vintage: 2019,
    same_vintage: true,
    trusted: true,
    tier: 1,
    known_publication: true,
    drinking_window: null,
    vintage_character: null,
    deal: false,
    ...overrides,
  }
}
