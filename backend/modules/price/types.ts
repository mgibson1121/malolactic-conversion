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

// Shape returned by Google Custom Search JSON API item
export interface CseItem {
  link: string
  displayLink: string
  title: string
  snippet?: string
  pagemap?: {
    offer?: Array<{ price?: string }>
  }
}

// Shape GPT-4o returns per product page
export interface GptPageExtraction {
  price: number | null
  url: string
  critic_scores: CriticScore[]
}
