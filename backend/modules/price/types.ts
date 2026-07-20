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
  // Number of standard bottles bundled into this listing's price (1 for an
  // ordinary single-bottle listing). See pack-format.ts.
  pack_quantity: number
  // Parsed bottle volume in mL when the listing states a non-default size
  // (e.g. 1500 for a magnum). Null when unstated (assumed standard 750ml).
  bottle_size_ml: number | null
  // True when this listing is a multi-bottle pack/case or an explicitly
  // non-750ml bottle — its price is not a standard single-bottle price and
  // must be excluded from price_min/avg/max and nearest-retailer selection,
  // the same way a confirmed vintage_mismatch is. Still shown in the
  // retailer list, badged, for transparency.
  non_standard_format: boolean
  // Short UI label for the badge, e.g. "6-pack", "1.5L", "6 x 375ml". Empty
  // string when non_standard_format is false.
  format_label: string
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
