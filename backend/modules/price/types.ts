export interface CriticScore {
  publication: string
  score: number
}

export interface RetailerResult {
  slug: string
  name: string
  price: number | null
  url: string
  critic_scores: CriticScore[]
  is_preferred_retailer: boolean
  distance_miles: number
}

export interface PriceData {
  price_min: number | null
  price_avg: number | null
  price_max: number | null
  retailers: RetailerResult[]
  nearest_retailer: RetailerResult | null
  fetched_at: string
}

// Shape GPT-4o returns per product page
export interface GptPageExtraction {
  price: number | null
  url: string
  critic_scores: CriticScore[]
}
