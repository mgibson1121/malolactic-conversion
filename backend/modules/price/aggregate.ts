import type { HeadlineBasis, PriceExcludedCounts, PriceGroup } from '@shared/types'
import type { PriceData, RetailerResult } from './types'

/** Highest counted per-750 ml price over the lowest at which no single average is offered (Phase 12.2 D10). */
export const AMBIGUOUS_PRICE_RATIO = 2.5

/** A listing this many times the median of its comparables has its page read first (Phase 12.2 D11). */
export const LARGE_FORMAT_RATIO = 1.75

/** The per-750 ml price this listing counts at: the normalised price when it has one, else the shelf price. */
export function countedPrice(r: Pick<RetailerResult, 'price' | 'price_per_750'>): number | null {
  return r.price_per_750 ?? r.price
}

/**
 * Whether a listing may feed the headline figures. A confirmed other-vintage
 * listing, an uncertain pack or size, a search-only link, a listing the price
 * ratio flagged as a probable large format, and one with no price do not.
 * A certain six-pack / case / magnum does: it counts at its 750 ml price.
 */
export function isCountable(r: RetailerResult): boolean {
  return (
    !r.vintage_mismatch &&
    (!r.non_standard_format || !!r.normalized) &&
    !r.suspected_large_format &&
    !r.outside_bottling &&
    !r.sold_out &&
    !r.link_only &&
    countedPrice(r) !== null
  )
}

/**
 * Drops prices that are wildly out of line with the rest of the set
 * (2026-08-05).
 *
 * `pack-format.ts` catches a listing that *says* it is a case or a magnum.
 * It cannot catch one that doesn't: a Rully priced at $2,044.76 and a village
 * Marsannay at $299.99 both came back titled as ordinary 750ml bottles in the
 * 2026-08-04 batch, and both set price_max. A retailer's own data-entry error
 * looks identical.
 *
 * Uses an interquartile fence rather than a fixed multiple of the cheapest
 * listing, because wine prices spread genuinely wide and a fixed rule is
 * either too tight for Burgundy or useless for Muscadet.
 *
 * The fence is applied in *log* space. Prices are roughly log-normal, and the
 * failure this catches is multiplicative — a case of twelve is ~12× a bottle,
 * a magnum ~2–3×. An additive fence has to be set so loose to accommodate a
 * genuine $86–$430 Burgundy spread that it then waves through a $1,486
 * Chablis, which is exactly what happened on the 2026-08-05 run. In log space
 * the textbook 1.5×IQR keeps that Burgundy spread intact and still rejects
 * both the $1,486 and a $2,044 Rully.
 *
 * Nothing is dropped below four prices: with three or fewer there is no
 * distribution to reason about, and discarding one of three real prices is a
 * bigger error than keeping one bad one. Excluded listings still appear in
 * the retailer list — this only governs the headline figures.
 */
export function excludeOutliers(prices: number[]): number[] {
  if (prices.length < 4) return prices
  // log() needs strictly positive input; a non-positive price is not a price.
  if (prices.some(p => p <= 0)) return prices

  const logs = prices.map(Math.log).sort((a, b) => a - b)
  const quantile = (q: number) => {
    const pos = (logs.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return logs[lo] + (logs[hi] - logs[lo]) * (pos - lo)
  }

  const q1 = quantile(0.25)
  const q3 = quantile(0.75)
  const iqr = q3 - q1
  // No spread at all — nothing can be an outlier.
  if (iqr === 0) return prices

  const upper = q3 + 1.5 * iqr
  const lower = q1 - 1.5 * iqr
  const kept = prices.filter(p => Math.log(p) >= lower && Math.log(p) <= upper)

  // Never return nothing: if the test would empty the set, it is the test
  // that is wrong about this data, not the data.
  return kept.length > 0 ? kept : prices
}

/**
 * Drops a price wildly out of line with the rest, for sets too small for
 * `excludeOutliers`' quartile fence to reason about (2026-08-12).
 *
 * `other_vintage_price_range` is fed by `vintage_mismatch` listings, which
 * are usually a handful at most — Bessin-Tremblay's 2026-08-12 run had
 * exactly three: $37.99 / $84.99 / $1,486. `excludeOutliers` requires four
 * prices before it will drop anything, so that set passed through untouched
 * and the $1,486 landed in the UI's advisory range. Worse, quartile-based
 * IQR is the wrong tool even if the four-price gate were lowered: at n=3 the
 * outlier itself is one of only three points feeding Q3, so it pulls its own
 * fence wide enough to survive (confirmed: the same $1,486 still clears an
 * IQR fence run directly against this three-price set). A median is immune
 * to that — the median of an odd-length set is the middle value and doesn't
 * move no matter how extreme the top or bottom entry is.
 *
 * This range is advisory ("no price for this vintage, but others have run
 * $86-$430"), not the headline figure, so a looser, ratio-based fence is the
 * right trade here — reject anything more than 5x above or below the
 * median. Needs at least three prices for a median that isn't just an
 * average of the two inputs (which would arbitrarily favor whichever side
 * of a 2-element set happens to be near their average).
 */
export function excludeExtremeOutliers(prices: number[]): number[] {
  if (prices.length < 3) return prices
  if (prices.some(p => p <= 0)) return prices

  const sorted = [...prices].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]

  const RATIO_FENCE = 5
  const kept = prices.filter(p => p / median <= RATIO_FENCE && median / p <= RATIO_FENCE)

  // Never return nothing: an all-extreme set (shouldn't happen given the
  // median is always in range of itself) falls back to the input rather
  // than an empty advisory range.
  return kept.length > 0 ? kept : prices
}

export type ExclusionReason = keyof Omit<PriceExcludedCounts, 'outlier' | 'sold_out'> | 'no_price' | 'outside_bottling' | 'sold_out'

/**
 * Why a listing is kept out of the headline, in the priority order the counts
 * use (each listing is counted once), or null when it counts. The outlier
 * fence is applied afterwards on the counted set and is reported separately.
 * Shared with the explain-wine diagnostic so the two cannot disagree.
 */
export function exclusionReason(r: RetailerResult): ExclusionReason | null {
  if (r.link_only) return 'link_only'
  if (r.vintage_mismatch) return 'other_vintage'
  if (r.non_standard_format && !r.normalized) return r.pack_quantity > 1 ? 'pack' : 'non_standard_format'
  if (r.suspected_large_format) return 'suspected_large_format'
  if (r.outside_bottling) return 'outside_bottling'
  if (r.sold_out) return 'sold_out'
  if (countedPrice(r) === null) return 'no_price'
  return null
}

/**
 * Splits sorted prices at the largest adjacent jump (Phase 12.2 WI-2). Vietti
 * Barolo: $74.99 | $149-$245. Proposed rule from the spec; both groups are
 * always shown, nothing is dropped.
 */
function splitAtLargestJump(entries: Array<{ price: number; slug: string }>): PriceGroup[] {
  const sorted = [...entries].sort((a, b) => a.price - b.price)
  let at = 1
  let biggest = -1
  for (let i = 1; i < sorted.length; i++) {
    const jump = sorted[i].price - sorted[i - 1].price
    if (jump > biggest) {
      biggest = jump
      at = i
    }
  }
  const group = (list: typeof sorted): PriceGroup => ({
    min: list[0].price,
    max: list[list.length - 1].price,
    retailers: list.map(e => e.slug),
  })
  return [group(sorted.slice(0, at)), group(sorted.slice(at))]
}

/**
 * Computes price_min/avg/max, nearest_retailer and (Phase 12.2) the exclusion
 * breakdown and headline basis from a retailers list. Pure — no I/O. Exported
 * so callers that already have a RetailerResult[] from somewhere other than a
 * fresh fetchPriceData run (the confirm-retailer-link flow, the "Which
 * bottling is yours?" re-score) don't duplicate this math.
 *
 * Order of operations (spec WI-2.4): normalise certain packs and magnums to a
 * 750 ml price; drop other-vintage, uncertain-format, search-only and
 * ratio-flagged listings; if the highest counted price is 2.5x the lowest or
 * more, offer no single average and show both groups (nothing dropped);
 * otherwise apply the interquartile fence for single-point outliers.
 */
export function aggregatePriceData(retailers: RetailerResult[]): PriceData {
  // A confirmed vintage_mismatch means the listing is definitely a different
  // year of this wine, not this wine at that price. An uncertain
  // non_standard_format listing (a 3-pack, a half bottle, a 3 L bottle, a
  // title whose size signals disagree) isn't a single 750 ml bottle price at
  // all. Both stay in the retailers list (badged in the UI) for transparency,
  // but neither may feed the headline price stats or be selectable as
  // "nearest retailer". A certain six-pack, 12-case or magnum is the exception
  // (Phase 12.2 D7): it counts at its price per 750 ml bottle. A link_only
  // entry (K&L) has no verifiable price at all and must never win "nearest
  // retailer" on the strength of its coordinates alone.
  const eligibleForStats = retailers.filter(isCountable)

  const entries = eligibleForStats.map(r => ({ r, price: countedPrice(r) as number }))
  const spans = entries.length >= 2 &&
    Math.max(...entries.map(e => e.price)) / Math.min(...entries.map(e => e.price)) >= AMBIGUOUS_PRICE_RATIO
  const ambiguous = spans && entries.every(e => e.price > 0)

  let kept = entries
  let outliers = 0
  if (!ambiguous) {
    const fenced = excludeOutliers(entries.map(e => e.price))
    const remaining = [...fenced]
    kept = entries.filter(e => {
      const i = remaining.indexOf(e.price)
      if (i === -1) return false
      remaining.splice(i, 1)
      return true
    })
    outliers = entries.length - kept.length
  }

  const prices = kept.map(e => e.price)
  const price_min = !ambiguous && prices.length ? Math.min(...prices) : null
  const price_max = !ambiguous && prices.length ? Math.max(...prices) : null
  const price_avg =
    !ambiguous && prices.length
      ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100
      : null

  const headline_basis: HeadlineBasis = ambiguous
    ? 'ambiguous'
    : prices.length === 0
      ? 'none'
      : prices.length === 1
        ? 'single_listing'
        : 'multiple'

  // A normalised listing that alone is the headline, or sets the min or the
  // max, makes it an estimate: a magnum often carries a premium and a case a
  // discount, so the division is an approximation.
  const headline_estimated =
    !ambiguous &&
    prices.length > 0 &&
    (prices.length === 1
      ? !!kept[0].r.normalized
      : kept.some(e => !!e.r.normalized && (e.price === price_min || e.price === price_max)))

  const excluded: PriceExcludedCounts = {
    other_vintage: 0,
    pack: 0,
    non_standard_format: 0,
    suspected_large_format: 0,
    link_only: 0,
    outside_bottling: 0,
    sold_out: 0,
    outlier: outliers,
  }
  for (const r of retailers) {
    const why = exclusionReason(r)
    if (why && why !== 'no_price') excluded[why] = (excluded[why] ?? 0) + 1
  }

  // Prices found for a different year of this wine (2026-08-05). Reported
  // separately rather than folded in: a 2020's price is not the 2022's. But
  // "no price at all" and "nothing for this year, though the 2021 runs
  // $28-$150" are very different things to show. Non-standard formats stay
  // excluded here too — a wrong-vintage magnum tells you even less than a
  // wrong-vintage bottle.
  const otherVintagePrices = excludeExtremeOutliers(
    retailers
      .filter(r => r.vintage_mismatch && !r.non_standard_format && r.price !== null)
      .map(r => r.price as number)
  )
  const other_vintage_price_range =
    otherVintagePrices.length > 0
      ? { min: Math.min(...otherVintagePrices), max: Math.max(...otherVintagePrices) }
      : null

  // Only preferred retailers are eligible for nearest-to-NYC — fallback results have no coords
  // A product page from another storefront of the same shop can't be the
  // nearest store (Phase 12.2 WI-6) — unless it is all there is.
  const here = eligibleForStats.filter(r => !r.other_storefront)
  const nearestPool = here.length > 0 ? here : eligibleForStats
  const preferred = nearestPool.filter(r => r.is_preferred_retailer)
  const nearest_retailer =
    preferred.length > 0
      ? [...preferred].sort((a, b) => a.distance_miles - b.distance_miles)[0]
      : nearestPool[0] ?? null

  return {
    price_min,
    price_avg,
    price_max,
    other_vintage_price_range,
    retailers,
    nearest_retailer,
    fetched_at: new Date().toISOString(),
    excluded,
    normalized: (ambiguous ? entries : kept).filter(e => !!e.r.normalized).length,
    headline_basis,
    price_groups: ambiguous ? splitAtLargestJump(entries.map(e => ({ price: e.price, slug: e.r.slug }))) : null,
    headline_estimated,
  }
}
