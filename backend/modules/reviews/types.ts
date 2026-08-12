import type { MatchVerdict } from '@shared/utils/wine-match'

export interface CriticDrinkingWindow {
  start: number | null
  end: number | null
}

export interface CriticScore {
  publication: string
  score: number
  known_publication: boolean
  // Phase 8 fields — see shared/types.ts CriticScore for the field-level docs
  // this local type mirrors (kept structurally identical, never imported
  // across modules — see CLAUDE.md §5).
  drinking_window: CriticDrinkingWindow | null
  vintage_character: 'below_avg' | 'avg' | 'good' | 'very_good' | null
  deal: boolean
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
  // 'configured' — found via one of RETAILER_CONFIG's site:-restricted
  // searches (or a manually-confirmed URL for a configured retailer, via
  // confirm-retailer-link). 'fallback' — found via the open-web fallback
  // pass (Phase 7.3, 2026-08-02), which only runs when every configured
  // retailer returned zero critic scores. Distinguished because a fallback
  // result comes from an un-vetted domain (not one the developer explicitly
  // trusts as a wine retailer), so the UI should be able to show it with
  // less confidence than a configured-retailer result.
  source: 'configured' | 'fallback'
  // Phase 9.1 — see shared/types.ts RetailerReview for the field-level docs
  // this local type mirrors (kept structurally identical, never imported
  // across modules — see CLAUDE.md §5).
  page_vintage: number | null
  vintage_gap: number | null
  match: MatchVerdict
  page_price: number | null
}
