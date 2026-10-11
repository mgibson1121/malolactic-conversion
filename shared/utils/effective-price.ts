import type { PriceData } from '../types'

/**
 * The price the app treats as *the* price (Phase 12.1 D12): the developer's
 * own manual price when set, otherwise the automated average, otherwise
 * nothing. Every surface that shows, sorts or filters by price goes through
 * this — the Swift mirror (`EffectivePrice.swift`) is covered by the shared
 * fixture parity test.
 *
 * The automated avg/high/low stay visible but become informational when a
 * manual price is set, the same primary/informational pattern as drinking
 * windows. A manual price is never overwritten by any fetch.
 */
export interface EffectivePrice {
  value: number | null
  basis: 'manual' | 'automated' | null
}

export function effectivePrice(wine: {
  manual_price?: number | null
  price_data?: Pick<PriceData, 'price_avg'> | null
}): EffectivePrice {
  if (wine.manual_price != null) return { value: wine.manual_price, basis: 'manual' }
  const avg = wine.price_data?.price_avg
  if (avg != null) return { value: avg, basis: 'automated' }
  return { value: null, basis: null }
}
