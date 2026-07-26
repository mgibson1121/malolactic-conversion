export interface CriticScore {
  publication: string
  score: number
  known_publication: boolean
}

// Shape GPT-4o returns per rendered product page (gpt-extract.ts)
export interface GptPageExtraction {
  price: number | null
  url: string
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
