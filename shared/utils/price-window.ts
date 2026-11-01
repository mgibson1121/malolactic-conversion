import type { PriceData, PriceWindow, RetailerPrice } from '../types'
import { withinSimilarVintage } from './review-ladder'

/**
 * What the price list displays (Phase 12.4 WI-1): listings within ±3 vintages
 * of the wine. Derived on every read and never stored — `price_data` keeps
 * every listing, and the headline is unchanged (it counts only same-vintage
 * listings already). `hidden` names the rows a client leaves out;
 * `other_vintage_price_range` is the "Other vintages" line over the listings
 * that remain, so an 11-year-old bottle no longer widens it. `order` is the
 * rows still shown, in the one display order both clients use (WI-3).
 */
export function priceWindowOf(priceData: PriceData | null | undefined, wineVintage: number | null | undefined): PriceWindow | null {
  if (!priceData) return null
  const hidden = priceData.retailers.filter(r => !withinSimilarVintage(r.matched_vintage, wineVintage)).map(r => r.slug)
  const others = priceData.retailers
    .filter(r => r.vintage_mismatch && !r.non_standard_format && r.price != null && !hidden.includes(r.slug))
    .map(r => r.price as number)
  return {
    hidden,
    other_vintage_price_range: others.length > 0 ? { min: Math.min(...others), max: Math.max(...others) } : null,
    order: orderRetailers(priceData.retailers.filter(r => !hidden.includes(r.slug)), priceData.nearest_retailer?.slug ?? null).map(r => r.slug),
  }
}

// A stored row should always have a name; never throw on one that doesn't.
const byName = (a: RetailerPrice, b: RetailerPrice) => (a.name ?? a.slug).localeCompare(b.name ?? b.slug, 'en', { sensitivity: 'base' })

/**
 * The retailer list's order (Phase 12.4 WI-3, developer 2026-10-31): the
 * nearest store first, then the other configured ("preferred") shops A–Z,
 * then every other listing A–Z. One comparator, computed in the backend, so
 * the web and the phone can't disagree. Stable for equal names.
 */
export function orderRetailers(retailers: RetailerPrice[], nearestSlug: string | null): RetailerPrice[] {
  const nearest = retailers.filter(r => r.slug === nearestSlug)
  const rest = retailers.filter(r => r.slug !== nearestSlug)
  return [
    ...nearest,
    ...rest.filter(r => r.is_preferred_retailer).sort(byName),
    ...rest.filter(r => !r.is_preferred_retailer).sort(byName),
  ]
}
