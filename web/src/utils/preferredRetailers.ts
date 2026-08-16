import type { PriceData, RetailerPrice } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'

/**
 * Frontend-only summary of whether any preferred retailer carries this wine
 * (Phase 9.3, WI-4). Computed entirely from the price fetch's existing
 * result — zero additional Serper cost.
 */
export function summarizePreferredRetailers(priceData: PriceData | null): {
  carried: RetailerPrice[]
  totalConfigured: number
} {
  const carried = (priceData?.retailers ?? []).filter((r) => r.is_preferred_retailer)
  return { carried, totalConfigured: RETAILER_CONFIG.length }
}
