import type { WineEntry } from '@shared/types'
import type { WineSearcherMerchant, WineSearcherResponse, WineSearcherResult } from './types'

// Wine-Searcher API v1 — https://www.wine-searcher.com/trade/ws-api
// Required params: api_key, winename
// Optional: vintage, location (e.g. "US-NY"), num_results, format=json
const WS_BASE_URL = 'https://www.wine-searcher.com/api/default/v1/'
const DEFAULT_LOCATION = 'US-NY'
const NUM_RESULTS = 10

function buildWineName(wine: WineEntry): string {
  const parts = [wine.producer, wine.denomination].filter(Boolean)
  if (wine.vintage) parts.push(String(wine.vintage))
  return parts.join(' ')
}

function parseLocation(merchant: WineSearcherMerchant): string | null {
  const parts = [merchant.state, merchant.country].filter(Boolean)
  return parts.length ? parts.join(', ') : merchant['physical-address'] ?? null
}

export async function fetchPriceData(wine: WineEntry): Promise<WineSearcherResult | null> {
  const apiKey = process.env.WINE_SEARCHER_API_KEY
  if (!apiKey) return null

  const wineName = buildWineName(wine)
  if (!wineName.trim()) return null

  const params = new URLSearchParams({
    api_key: apiKey,
    winename: wineName,
    format: 'json',
    num_results: String(NUM_RESULTS),
    location: DEFAULT_LOCATION,
  })
  if (wine.vintage) params.set('vintage', String(wine.vintage))

  const url = `${WS_BASE_URL}?${params.toString()}`

  let data: WineSearcherResponse
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`Wine-Searcher API error: ${res.status} ${res.statusText}`)
      return null
    }
    data = await res.json() as WineSearcherResponse
  } catch (err) {
    console.error('Wine-Searcher fetch failed:', err)
    return null
  }

  // Return code 0 = success; anything else = no match or error
  if (data.Status && data.Status.ReturnCode !== 0) {
    console.warn(`Wine-Searcher returned code ${data.Status.ReturnCode}: ${data.Status.StatusMessage}`)
    return null
  }

  const stats = data.Statistics
  const merchants = (data.Price ?? []).slice(0, NUM_RESULTS)

  const retailers = merchants.map(m => ({
    name: m['merchant-name'] ?? 'Unknown',
    price: m.price,
    url: m.link ?? null,
    location: parseLocation(m),
  }))

  // Sort by price ascending
  retailers.sort((a, b) => a.price - b.price)

  return {
    min_price: stats?.['price-min'] ?? null,
    avg_price: stats?.['price-avg'] ?? null,
    max_price: stats?.['price-max'] ?? null,
    ws_score: data.score ?? null,
    retailers,
    drinking_window_start: data['drink-from'] ?? null,
    drinking_window_end: data['drink-to'] ?? null,
    fetched_at: new Date().toISOString(),
  }
}
