import type { PriceData, PriceExclusions, RetailerPrice } from '../types'

/**
 * Why a price lookup that found listings has no average (Phase 12.1 WI-4).
 *
 * The "Marcoux" case: five listings, all excluded from the headline stats
 * (other vintages, a magnum, search-only links), and the screen showed a row of
 * dashes with no explanation. This names the reasons, with counts, in plain
 * language. Null whenever there is an average, or no listings at all (that
 * case has its own message).
 *
 * Derived from the flags already on each retailer row, using exactly the
 * exclusions `aggregatePriceData` applies. Phase 12.2 WI-1 adds the breakdown
 * to price_data itself and counts certain packs/magnums at a 750 ml-equivalent
 * price, so this sentence will then list fewer of them — the function reads
 * the same flags, so it follows.
 *
 * Computed once, server-side, on every wine read, so the two frontends can
 * only ever say the same thing.
 */
export function describePriceExclusions(
  priceData: Pick<PriceData, 'price_avg' | 'retailers'> | null | undefined
): PriceExclusions | null {
  const retailers = priceData?.retailers ?? []
  if (!priceData || retailers.length === 0 || priceData.price_avg != null) return null

  const years = new Set<number>()
  let otherVintages = 0
  let searchOnly = 0
  let noPrice = 0
  const formats = new Map<string, number>()

  for (const r of retailers) {
    if (r.link_only) searchOnly++
    else if (r.vintage_mismatch) {
      otherVintages++
      if (r.matched_vintage != null) years.add(r.matched_vintage)
    } else if (r.non_standard_format) {
      const name = formatName(r)
      formats.set(name, (formats.get(name) ?? 0) + 1)
    } else if (r.price == null) noPrice++
  }

  const reasons: string[] = []
  if (otherVintages > 0) {
    const ys = [...years].sort((a, b) => a - b)
    reasons.push(`${otherVintages} other ${otherVintages === 1 ? 'vintage' : 'vintages'}${ys.length ? ` (${ys.join(', ')})` : ''}`)
  }
  for (const [name, n] of formats) reasons.push(`${n} ${n === 1 ? name : pluralize(name)}`)
  if (searchOnly > 0) reasons.push(`${searchOnly} search-only`)
  if (noPrice > 0) reasons.push(`${noPrice} without a price`)

  const found = retailers.length
  const lead = `${found} ${found === 1 ? 'listing' : 'listings'} found, none counted toward the average`
  return { found, reasons, sentence: reasons.length ? `${lead}: ${reasons.join(', ')}.` : `${lead}.` }
}

/** "six-pack", "magnum", "6 × magnum", "3L bottle" — how a listing's format reads in a sentence. */
function formatName(r: Pick<RetailerPrice, 'pack_quantity' | 'bottle_size_ml'>): string {
  const size = r.bottle_size_ml != null && r.bottle_size_ml !== 750 ? sizeName(r.bottle_size_ml) : null
  if (r.pack_quantity > 1 && size) return `${r.pack_quantity} × ${size}`
  if (r.pack_quantity > 1) return r.pack_quantity === 6 ? 'six-pack' : r.pack_quantity === 12 ? '12-bottle case' : `${r.pack_quantity}-pack`
  return size ?? 'other format'
}

function sizeName(ml: number): string {
  if (ml === 1500) return 'magnum'
  if (ml === 3000) return 'double magnum'
  if (ml === 375) return 'half bottle'
  if (ml === 187 || ml === 200) return 'split'
  return `${Number((ml / 1000).toFixed(2))}L bottle`
}

function pluralize(name: string): string {
  return name.includes(' × ') ? name : `${name}s`
}
