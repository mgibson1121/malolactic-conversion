import type { RetailerConfig } from './retailers.config'
import type { CseItem, RetailerResult } from './types'
import { haversineDistanceMiles } from './proximity'
import { NYC } from './retailers.config'

const CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1'

interface ShoppingHit {
  retailer: RetailerConfig
  link: string
  price: number | null
}

function parsePriceFromItem(item: CseItem): number | null {
  // Try pagemap offer price first (Shopping results carry this)
  const offerPrice = item.pagemap?.offer?.[0]?.price
  if (offerPrice) {
    const n = parseFloat(offerPrice.replace(/[^0-9.]/g, ''))
    if (!isNaN(n) && n > 0) return n
  }
  // Fallback: scan snippet for a dollar amount
  const match = item.snippet?.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/)
  if (match) {
    const n = parseFloat(match[1])
    if (!isNaN(n) && n > 0) return n
  }
  return null
}

export async function queryGoogleShopping(
  query: string,
  retailers: RetailerConfig[],
  apiKey: string,
  cseId: string
): Promise<ShoppingHit[]> {
  const params = new URLSearchParams({
    key: apiKey,
    cx: cseId,
    q: query,
    num: '10',
  })

  let items: CseItem[] = []
  try {
    const res = await fetch(`${CSE_ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const json = await res.json() as { items?: CseItem[] }
    items = json.items ?? []
  } catch {
    return []
  }

  const hits: ShoppingHit[] = []
  for (const retailer of retailers) {
    const match = items.find(item =>
      item.displayLink?.includes(retailer.domain) ||
      item.link?.includes(retailer.domain)
    )
    if (match) {
      hits.push({
        retailer,
        link: match.link,
        price: parsePriceFromItem(match),
      })
    }
  }
  return hits
}

export function hitsToRetailerResults(hits: ShoppingHit[]): RetailerResult[] {
  return hits.map(hit => ({
    slug: hit.retailer.slug,
    name: hit.retailer.name,
    price: hit.price,
    url: hit.link,
    critic_scores: [],
    distance_miles: Math.round(
      haversineDistanceMiles(NYC.lat, NYC.lng, hit.retailer.lat, hit.retailer.lng)
    ),
  }))
}
