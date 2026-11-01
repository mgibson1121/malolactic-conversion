import type { PriceData, PriceState, PriceWindow, RetailerPrice } from '../types'
import { isExactBottling } from './bottling-difference'

/**
 * The price block's one state (Phase 12.5 WI-1), computed once in the backend
 * — same pattern as `window_status` — so the web and the phone say the same
 * line. Derived on every read, never stored. Null when prices were never
 * looked up; "Checking prices…" and "Couldn't check prices" are request
 * states the clients own (a lookup in flight, an error body), not stored ones.
 *
 * Only what the list shows counts here: rows within ±3 vintages (WI-1 of
 * 12.4) that carry a price. A search-only link is not a price; it lives under
 * Trusted Retailers (WI-2).
 */
export function priceStateOf(priceData: PriceData | null | undefined, window: PriceWindow | null | undefined): PriceState | null {
  if (!priceData) return null
  const order = window?.order ?? priceData.retailers.filter(r => !window?.hidden.includes(r.slug)).map(r => r.slug)
  const shown = order
    .map(slug => priceData.retailers.find(r => r.slug === slug))
    .filter((r): r is RetailerPrice => r !== undefined && !r.link_only && r.price != null)
  const exact = shown.filter(isExactMatch).map(r => r.slug)
  const range = priceData.price_min != null && priceData.price_max != null ? { min: priceData.price_min, max: priceData.price_max } : null
  const base = { avg: priceData.price_avg ?? null, range, priced: shown.map(r => r.slug), exact }

  if (shown.length === 0) return { kind: 'nothing_found', line: 'No prices found', ...base }
  if (priceData.headline_basis === 'ambiguous') return { kind: 'wide_range', line: 'Prices vary widely', ...base }
  if (priceData.price_avg != null) {
    return priceData.headline_estimated
      ? { kind: 'estimated', line: `${dollars(priceData.price_avg)} avg · est.`, ...base }
      : { kind: 'priced', line: `${dollars(priceData.price_avg)} avg`, ...base }
  }
  if (shown.every(r => r.vintage_mismatch)) return { kind: 'similar_vintages', line: 'Similar vintages', ...base }
  return { kind: 'no_average', line: 'Prices found, no average', ...base }
}

/**
 * "Exact match" (WI-4): the listing is the exact wine — same bottling, no
 * other colour — and the exact vintage. Nothing looser earns it.
 */
export function isExactMatch(r: RetailerPrice): boolean {
  return (
    r.vintage_verdict === 'match' &&
    !r.vintage_mismatch &&
    !r.outside_bottling &&
    isExactBottling({ extra: r.bottling_difference?.extra ?? [], missing: r.bottling_difference?.missing ?? [], colour: r.bottling_difference?.colour })
  )
}

const dollars = (n: number) => `$${Math.round(n)}`
