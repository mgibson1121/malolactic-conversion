/**
 * Column definitions for each Google Sheet tab.
 * Indices are 0-based. Adding columns must append to the end to avoid breaking
 * existing rows.
 *
 * SHEET_COL_RANGE: upper-bound column letter used in all A:X range strings.
 * Must be updated whenever the widest tab exceeds the current value.
 * Current widest tab: wines (28 cols = A–AB).
 */
export const SHEET_COL_RANGE = 'AB'

export const WINE_COLS = {
  id: 0,
  cuvee: 1,                  // Tier 2 — repurposed from 'name' (removed in Phase 3)
  producer: 2,
  vintage: 3,
  region: 4,
  denomination: 5,
  grape_varieties: 6,        // Tier 2 — stored as JSON array string or empty
  label_image_url: 7,
  status: 8,
  cellar_category: 9,
  drinking_window_start: 10,
  drinking_window_end: 11,
  vintage_rating: 12,
  my_rating: 13,
  my_tags: 14,               // stored as JSON array string
  date_added: 15,
  date_consumed: 16,
  tasting_note_id: 17,       // FK to tasting_notes; set by createTastingNote
  expert_reviews: 18,        // JSON array of ExpertReview; null until Phase 6
  community_sentiment: 19,   // string; null until Phase 7
  community_excerpts: 20,    // JSON array of strings; null until Phase 7
  price_data: 21,            // JSON PriceData object; null until Phase 6
  wishlist_notes: 22,
  price_paid: 23,
  purchased_from: 24,
  advice_linked: 25,         // JSON array of advice UUIDs; appended by createAdvice
  quality_classification: 26, // Tier 2 — null until label scan or manual entry
  vineyard: 27,               // Tier 2 — null until label scan or manual entry
} as const

export const WINE_HEADERS = [
  'id', 'cuvee', 'producer', 'vintage', 'region', 'denomination',
  'grape_varieties', 'label_image_url', 'status', 'cellar_category',
  'drinking_window_start', 'drinking_window_end', 'vintage_rating',
  'my_rating', 'my_tags', 'date_added', 'date_consumed', 'tasting_note_id',
  'expert_reviews', 'community_sentiment', 'community_excerpts', 'price_data',
  'wishlist_notes', 'price_paid', 'purchased_from', 'advice_linked',
  'quality_classification', 'vineyard',
]

export const CELLAR_COLS = {
  id: 0,
  wine_id: 1,
  quantity: 2,
  location_notes: 3,
  date_acquired: 4,
  price_paid: 5,
  purchased_from: 6,
} as const

export const CELLAR_HEADERS = [
  'id', 'wine_id', 'quantity', 'location_notes', 'date_acquired', 'price_paid', 'purchased_from',
]

export const WISHLIST_COLS = {
  id: 0,
  wine_id: 1,
  wishlist_notes: 2,
  priority: 3,
} as const

export const WISHLIST_HEADERS = ['id', 'wine_id', 'wishlist_notes', 'priority']

export const TASTING_NOTE_COLS = {
  id: 0,
  wine_id: 1,
  tasted_at: 2,
  clarity: 3,
  colour_intensity: 4,
  colour: 5,
  nose_condition: 6,
  nose_intensity: 7,
  nose_primary_aromas: 8,    // JSON array
  nose_secondary_aromas: 9,  // JSON array
  nose_tertiary_aromas: 10,  // JSON array
  palate_sweetness: 11,
  palate_acidity: 12,
  palate_tannin: 13,
  palate_body: 14,
  palate_flavour_intensity: 15,
  palate_finish: 16,
  quality_assessment: 17,
  my_rating: 18,
  free_text: 19,
  tags: 20,                  // JSON array
} as const

export const TASTING_NOTE_HEADERS = [
  'id', 'wine_id', 'tasted_at', 'clarity', 'colour_intensity', 'colour',
  'nose_condition', 'nose_intensity', 'nose_primary_aromas', 'nose_secondary_aromas',
  'nose_tertiary_aromas', 'palate_sweetness', 'palate_acidity', 'palate_tannin',
  'palate_body', 'palate_flavour_intensity', 'palate_finish', 'quality_assessment',
  'my_rating', 'free_text', 'tags',
]

export const ADVICE_COLS = {
  id: 0,
  wine_id: 1,
  source_name: 2,
  source_role: 3,
  category: 4,
  content: 5,
  captured_at: 6,
} as const

export const ADVICE_HEADERS = [
  'id', 'wine_id', 'source_name', 'source_role', 'category', 'content', 'captured_at',
]

export const SHEET_NAMES = {
  wines: 'wines',
  cellar: 'cellar',
  wishlist: 'wishlist',
  tastingNotes: 'tasting_notes',
  advice: 'advice',
} as const
