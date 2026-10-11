import type { RetailerResult } from './types'
import { countedPrice, isCountable, LARGE_FORMAT_RATIO } from './aggregate'
import { pageStatedFormat, withStatedFormat } from './pack-format'

/** Product-page renders a single fetch may spend on this check (Phase 12.2 WI-3). Local time only, no Serper credit. */
export const MAX_PAGE_READS = 2

/** A listing needs at least this many other comparable listings before the ratio is a trigger at all (D11). */
const MIN_COMPARABLES = 3

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Pack and size for the listings that decide the headline (Phase 12.2 WI-3).
 *
 * Two triggers, one mechanism. A title-only parser cannot see "Case of 6" that
 * only the shop's own page says (the #41 lesson), and an outlier fence cannot
 * catch a lone listing, so:
 *
 *  1. **The listing that drives the headline** — the only counted listing, or
 *     the single listing that sets the min or the max — has its product page
 *     read for a stated format.
 *  2. **A merely expensive listing** — at least ~1.75x the median of three or
 *     more other comparable listings, with no size stated — has its page read
 *     first (D11). A trigger, not a verdict: a six-pack, case or magnum the
 *     page states is divided and counted (D7); a page that states nothing
 *     leaves the listing out of the average, labelled "price suggests a larger
 *     format — size unconfirmed". Sets of fewer than four comparable listings
 *     never use the ratio.
 *
 * Reads the page's `<title>`, `og:title` and first `<h1>` only (pageStatedFormat)
 * — never the body, where size pickers list every format the shop sells.
 *
 * Only a listing whose URL is a real product page can be read. A listing from a
 * Shopping snapshot points at a constructed search page, which has no single
 * product headline to read; the on-click "resolve retailer URL" action reads
 * the product page once it has one. A ratio-flagged listing that cannot be read
 * is treated as "nothing stated".
 *
 * Capped at MAX_PAGE_READS renders per fetch. Returns new listing objects
 * rather than mutating, in the same order.
 */
export async function checkHeadlineFormats(
  retailers: RetailerResult[],
  ownNames: Array<string | null | undefined>,
  render: (url: string) => Promise<string | null>
): Promise<RetailerResult[]> {
  const counted = retailers.filter(isCountable)
  if (counted.length === 0) return retailers

  const priceOf = (r: RetailerResult) => countedPrice(r) as number

  // slug -> why it is a candidate. Ratio triggers go first: they are the
  // ones that change the answer when the page is silent.
  const ratioFlagged = new Set<RetailerResult>()
  if (counted.length >= MIN_COMPARABLES + 1) {
    for (const r of counted) {
      if (r.normalized || r.pack_quantity !== 1 || r.bottle_size_ml !== null) continue
      const others = counted.filter(o => o !== r).map(priceOf)
      if (priceOf(r) >= LARGE_FORMAT_RATIO * median(others)) ratioFlagged.add(r)
    }
  }

  const headlineDriving = new Set<RetailerResult>()
  if (counted.length === 1) headlineDriving.add(counted[0])
  else {
    const byPrice = [...counted].sort((a, b) => priceOf(a) - priceOf(b))
    const lo = byPrice[0]
    const hi = byPrice[byPrice.length - 1]
    // Only a *unique* extreme "sets" the min or the max.
    if (priceOf(byPrice[1]) !== priceOf(lo)) headlineDriving.add(lo)
    if (priceOf(byPrice[byPrice.length - 2]) !== priceOf(hi)) headlineDriving.add(hi)
  }

  const candidates = [...ratioFlagged, ...[...headlineDriving].filter(r => !ratioFlagged.has(r))]
    .filter(r => !r.normalized && !r.non_standard_format)

  const updated = new Map<RetailerResult, RetailerResult>()
  let reads = 0
  for (const r of candidates) {
    let next = r
    const readable = !r.is_search_results_page
    if (readable && reads < MAX_PAGE_READS) {
      reads++
      const html = await render(r.url).catch(() => null)
      const format = html ? pageStatedFormat(html, ownNames) : null
      if (format) next = withStatedFormat(r, format)
    }
    // The page said a format: that (not the ratio) decides. Nothing stated and
    // the ratio fired: left out of the average, labelled.
    if (next === r && ratioFlagged.has(r)) next = { ...r, suspected_large_format: true }
    if (next !== r) updated.set(r, next)
  }

  return retailers.map(r => updated.get(r) ?? r)
}
