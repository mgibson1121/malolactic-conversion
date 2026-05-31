export interface CriticScore {
  publication: string
  score: number
}

export interface RetailerCrawlResult {
  slug: string
  name: string
  price: number | null
  url: string
  critic_scores: CriticScore[]
  distance_miles: number
}

export interface CrawlResult {
  price_min: number | null
  price_avg: number | null
  price_max: number | null
  retailers: RetailerCrawlResult[]
  nearest_retailer: RetailerCrawlResult | null
  fetched_at: string
}

// Shape GPT-4o returns per retailer page
export interface GptPageExtraction {
  price: number | null
  url: string
  critic_scores: CriticScore[]
}
