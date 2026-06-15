import type { RetailerConfig } from './retailers.config'
import type { RetailerResult } from './types'
import { haversineDistanceMiles } from './proximity'
import { NYC } from './retailers.config'

const SERPER_ENDPOINT = 'https://google.serper.dev/shopping'

interface SerperShoppingItem {
  title: string
  source: string
  link: string
  price?: string
  priceRaw?: number
}

interface SerperResponse {
  shopping?: SerperShoppingItem[]
}

function parsePriceString(price?: string): number | null {
  if (!price) return null
  const n = parseFloat(price.replace(/[^0-9.]/g, ''))
  return isNaN(n) || n <= 0 ? null : n
}

function itemToRetailerResult(
  item: SerperShoppingItem,
  retailer: RetailerConfig,
  isPreferred: boolean
): RetailerResult {
  return {
    slug: retailer.slug,
    name: retailer.name,
    price: item.priceRaw ?? parsePriceString(item.price),
    url: item.link,
    critic_scores: [],
    is_preferred_retailer: isPreferred,
    distance_miles: Math.round(
      haversineDistanceMiles(NYC.lat, NYC.lng, retailer.lat, retailer.lng)
    ),
  }
}

function buildFallbackResult(item: SerperShoppingItem): RetailerResult {
  const hostname = (() => {
    try { return new URL(item.link).hostname.replace(/^www\./, '') } catch { return item.source }
  })()
  return {
    slug: hostname,
    name: item.source,
    price: item.priceRaw ?? parsePriceString(item.price),
    url: item.link,
    critic_scores: [],
    is_preferred_retailer: false,
    distance_miles: 0,
  }
}

export async function querySerper(
  query: string,
  retailers: RetailerConfig[],
  apiKey: string
): Promise<RetailerResult[]> {
  let items: SerperShoppingItem[] = []
  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: `${query} wine`, gl: 'us' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const json = await res.json() as SerperResponse
    items = json.shopping ?? []
  } catch {
    return []
  }

  if (items.length === 0) return []

  // Pass 1 — preferred retailers
  const preferred: RetailerResult[] = []
  for (const retailer of retailers) {
    const match = items.find(item => item.link?.includes(retailer.domain))
    if (match) preferred.push(itemToRetailerResult(match, retailer, true))
  }
  if (preferred.length > 0) return preferred

  // Pass 2 — fallback: any retailer Serper found
  return items
    .filter(item => item.link && item.source)
    .slice(0, 5)
    .map(item => buildFallbackResult(item))
}
