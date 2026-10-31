import type { PriceData, PriceWindow } from '../types'
import { withinSimilarVintage } from './review-ladder'

/**
 * What the price list displays (Phase 12.4 WI-1): listings within ±3 vintages
 * of the wine. Derived on every read and never stored — `price_data` keeps
 * every listing, and the headline is unchanged (it counts only same-vintage
 * listings already). `hidden` names the rows a client leaves out;
 * `other_vintage_price_range` is the "Other vintages" line over the listings
 * that remain, so an 11-year-old bottle no longer widens it.
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
  }
}
