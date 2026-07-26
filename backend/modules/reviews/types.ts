export interface CriticScore {
  publication: string
  score: number
  known_publication: boolean
}

// Shape GPT-4o returns per rendered product page (gpt-extract.ts)
export interface GptPageExtraction {
  price: number | null
  url: string
  // Vintage stated on the page, if any (Phase 7.2) — used by the
  // confirm-retailer-link flow to tag matched_vintage/vintage_mismatch
  // against a manually-confirmed product page, same convention as the
  // price module's Serper-derived matched_vintage.
  vintage: number | null
  critic_scores: CriticScore[]
}

// Per-retailer result stored in review_data
export interface ReviewResult {
  slug: string
  name: string
  product_url: string
  critic_scores: CriticScore[]
  fetched_at: string
}
