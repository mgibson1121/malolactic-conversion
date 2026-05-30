// Wine-Searcher API response shape (JSON format)
// Field names verified against Wine-Searcher API v1 documentation.
// If field names change, update the parsing in index.ts only.

export interface WineSearcherMerchant {
  'merchant-name': string
  price: number
  link: string | null
  'physical-address': string | null
  state: string | null
  country: string | null
}

export interface WineSearcherStatistics {
  'price-min': number | null
  'price-avg': number | null
  'price-max': number | null
}

export interface WineSearcherResponse {
  Status?: {
    ReturnCode: number
    StatusMessage: string
  }
  // Top-level response for a matched wine
  Price?: WineSearcherMerchant[]
  Statistics?: WineSearcherStatistics
  score?: number | null
  // Drinking window fields (if returned by API)
  'drink-from'?: string | null
  'drink-to'?: string | null
}

export interface WineSearcherResult {
  min_price: number | null
  avg_price: number | null
  max_price: number | null
  ws_score: number | null
  retailers: Array<{
    name: string
    price: number
    url: string | null
    location: string | null
  }>
  drinking_window_start: string | null
  drinking_window_end: string | null
  fetched_at: string
}
