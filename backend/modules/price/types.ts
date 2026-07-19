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
  // True when `url` is a constructed search-results page rather than a
  // single product page (currently true for all preferred-retailer matches
  // — see retailer-search-url.ts). Step 2 (Puppeteer + GPT-4o critic score
  // extraction) is skipped for these: the extraction prompt only extracts
  // from single product pages, so running it against a search-results page
  // burns a full Puppeteer render + GPT-4o call for a guaranteed null result.
  is_search_results_page: boolean
  // Vintage year parsed from the matched listing's title, if any (e.g. a
  // 4-digit 19xx/20xx year). Null if no year could be parsed.
  matched_vintage: number | null
  // True when matched_vintage is known and differs from the wine entry's own
  // vintage — the price/listing shown is for a different year of the same
  // wine, not the exact vintage requested. UI must surface this rather than
  // implying the price applies to the requested vintage.
  vintage_mismatch: boolean
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
