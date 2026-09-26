import type { WineEntry } from '@shared/types'

/**
 * The price rule (developer decision, 2026-09-26): a wine with no stored
 * price data is priced automatically, once; after that price only changes
 * when the user clicks Refresh. Opening a wine that already has prices never
 * makes a call.
 *
 * "Once" is guarded per page session, not just by `price_data === null`: a
 * fetch that fails leaves price_data null, and without this set every reopen
 * of that wine would fire another paid request. Same rule and same guard as
 * the iOS app's `PriceOnce` (ios/WineApp/Logic/PriceOnce.swift).
 */
const attempted = new Set<string>()

/** True — and records the attempt — when this wine should be priced now. */
export function claimPriceOnce(wine: Pick<WineEntry, 'id' | 'price_data'>): boolean {
  if (wine.price_data || attempted.has(wine.id)) return false
  attempted.add(wine.id)
  return true
}

/** Tests only. */
export function resetPriceOnce(): void {
  attempted.clear()
}
