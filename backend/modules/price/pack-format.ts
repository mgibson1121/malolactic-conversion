// Parses multi-bottle packs (e.g. "6-Pack", "Case of 6") and non-standard
// bottle sizes (e.g. "1.5L", "Magnum") out of a retailer listing title.
//
// A price for a 6-pack or a magnum is not the price of a standard 750ml
// bottle, and blending it into price_min/avg/max or "nearest retailer"
// alongside single-bottle prices produces a number that doesn't answer "what
// does a bottle of this wine cost" — a 6-pack can inflate price_max by 5-6x,
// and a magnum typically carries a rarity premium well above 2x a standard
// bottle, so neither can be safely normalized by just dividing/scaling.
// Same treatment as vintage_mismatch: detect it, keep the listing visible
// (badged) for transparency, exclude it from the aggregate numbers.

import { foldDiacritics } from '@shared/utils/wine-match'
import type { NormalizedFormat } from '@shared/types'

export interface PackFormat {
  // Number of standard bottles bundled into this single listing/price.
  // 1 for an ordinary single-bottle listing (the common case, and the
  // default when nothing in the title suggests otherwise).
  pack_quantity: number
  // Parsed bottle volume in mL, e.g. 1500 for a magnum. Null when the title
  // doesn't state a size — standard 750ml is by far the most common
  // unstated default, so "unknown" and "standard" are treated the same way
  // (i.e. not flagged) rather than guessing.
  bottle_size_ml: number | null
  // Phase 12.2: set (true) only when the text states two different pack counts
  // or two different sizes. Such a listing is never normalised — "if two
  // signals disagree the listing is uncertain".
  conflicting?: true
}

const NAMED_FORMAT_ML: Array<[RegExp, number]> = [
  [/\bhalf[\s-]?bottle\b/i, 375],
  [/\bsplit\b/i, 375],
  [/\bdouble[\s-]?magnum\b/i, 3000],
  [/\bjeroboam\b/i, 3000],
  [/\bmagnum\b/i, 1500],
  [/\brehoboam\b/i, 4500],
  [/\bmethuselah\b/i, 6000],
  [/\bimperial\b/i, 6000],
  [/\bsalmanazar\b/i, 9000],
  [/\bbalthazar\b/i, 12000],
  [/\bnebuchadnezzar\b/i, 15000],
]

// Every size the text states, first-found order (metric volume, then ml, then
// named formats). The first is the answer, as it always was; a second,
// different one makes the listing `conflicting`.
function parseBottleSizes(title: string): number[] {
  const found: number[] = []
  // Explicit metric volume: "1.5L", "1.5 L", "1.5 Liter(s)", "375ml", "750 mL"
  const literMatch = title.match(/\b(\d+(?:\.\d+)?)\s?(?:l|liters?|litres?)\b/i)
  if (literMatch) found.push(Math.round(parseFloat(literMatch[1]) * 1000))
  const mlMatch = title.match(/\b(\d{2,5})\s?ml\b/i)
  if (mlMatch) found.push(parseInt(mlMatch[1], 10))
  for (const [pattern, ml] of NAMED_FORMAT_ML) {
    if (pattern.test(title)) found.push(ml)
  }
  return found
}

// Every pack count the text states, priority order — see parseBottleSizes.
function parsePackQuantities(title: string): number[] {
  const found: number[] = []
  const packMatch = title.match(/\b(\d{1,2})[\s-]?(?:pack|pk)\b/i)
  if (packMatch) found.push(parseInt(packMatch[1], 10))
  const caseOfMatch = title.match(/\bcase of (\d{1,2})\b/i)
  if (caseOfMatch) found.push(parseInt(caseOfMatch[1], 10))
  if (/\bdozen\b/i.test(title)) found.push(12)
  if (/\bhalf[\s-]?case\b/i.test(title)) found.push(6)
  if (/\bfull[\s-]?case\b/i.test(title)) found.push(12)
  return found
}

const disagree = (values: number[]) => new Set(values).size > 1

/**
 * The title with every word of the wine's own name blanked out (2026-10-04).
 * Bottle formats are named after biblical kings, and so are producers:
 * Franck **Balthazar**'s Cornas came back with all five listings flagged
 * "12L" — the producer's name read as a 12-litre bottle — and no price.
 * CVNE's "Imperial" Rioja would read as a 6-litre one. A word that names the
 * wine can't also be telling us its size. Numeric sizes ("1.5L", "6x750ml")
 * are untouched, so a magnum of Balthazar's Cornas is still a magnum.
 */
function withoutOwnNames(title: string, ownNames: Array<string | null | undefined>): string {
  const words = new Set(
    ownNames.flatMap(n => foldDiacritics(n ?? '').toLowerCase().split(/[^a-z0-9]+/)).filter(w => w.length >= 3)
  )
  if (words.size === 0) return title
  return foldDiacritics(title).replace(/[A-Za-z0-9]+/g, w => (words.has(w.toLowerCase()) ? ' ' : w))
}

/** `ownNames`: the wine's producer, cuvée and vineyard — see withoutOwnNames. */
export function extractPackFormat(rawTitle: string, ownNames: Array<string | null | undefined> = []): PackFormat {
  const title = withoutOwnNames(rawTitle, ownNames)
  // "6 x 750ml" / "6x750ml" states pack size and bottle size together —
  // handle it as one match so a bundle listing doesn't get misread as a
  // single non-standard-size bottle (or vice versa).
  const bundleMatch = title.match(/\b(\d{1,2})\s?x\s?(\d{2,5})\s?ml\b/i)
  if (bundleMatch) {
    return {
      pack_quantity: parseInt(bundleMatch[1], 10),
      bottle_size_ml: parseInt(bundleMatch[2], 10),
    }
  }

  // "6 x 1.5L" / "6 x Magnum": a bundle of large bottles (Phase 12.2) — six
  // magnums are not a magnum, and must never be divided as one.
  const bigBundle = title.match(/\b(\d{1,2})\s?x\s?(?:(\d+(?:\.\d+)?)\s?(?:l|liters?|litres?)\b|(magnum)\b)/i)
  if (bigBundle) {
    return {
      pack_quantity: parseInt(bigBundle[1], 10),
      bottle_size_ml: bigBundle[2] ? Math.round(parseFloat(bigBundle[2]) * 1000) : 1500,
    }
  }

  const quantities = parsePackQuantities(title)
  const sizes = parseBottleSizes(title)
  return {
    pack_quantity: quantities[0] ?? 1,
    bottle_size_ml: sizes[0] ?? null,
    ...(disagree(quantities) || disagree(sizes) ? { conflicting: true as const } : {}),
  }
}

// True when this listing is not a single standard (750ml) bottle — a
// multi-bottle pack/case, or an explicitly stated non-750ml size.
export function isNonStandardFormat(format: PackFormat): boolean {
  return format.pack_quantity !== 1 || (format.bottle_size_ml !== null && format.bottle_size_ml !== 750)
}

/**
 * The format a listing can be counted at, when — and only when — the system
 * is certain (Phase 12.2 WI-1, D7): a six-pack, a 12-bottle case or a magnum.
 * Anything else (half bottles, 3 L and up, 3-packs, gift sets, six magnums, a
 * title whose signals disagree) is null and stays excluded.
 *
 * A pack counts only of 750 ml bottles: "6 x 375ml" is not six standard
 * bottles. A magnum counts only as a single 1.5 L bottle.
 */
export function certainNormalization(
  format: PackFormat
): { kind: 'pack' | 'case' | 'magnum'; divisor: 6 | 12 | 2 } | null {
  if (format.conflicting) return null
  const standardBottles = format.bottle_size_ml === null || format.bottle_size_ml === 750
  if (format.pack_quantity === 6 && standardBottles) return { kind: 'pack', divisor: 6 }
  if (format.pack_quantity === 12 && standardBottles) return { kind: 'case', divisor: 12 }
  if (format.pack_quantity === 1 && format.bottle_size_ml === 1500) return { kind: 'magnum', divisor: 2 }
  return null
}

/**
 * The normalisation fields for a listing, or an empty object. Spread into the
 * RetailerResult: `{ ...normalizationFor(format, price, 'title') }`.
 */
export function normalizationFor(
  format: PackFormat,
  shelfPrice: number | null,
  source: 'title' | 'page'
): { normalized: NormalizedFormat; price_per_750: number } | Record<string, never> {
  const certain = certainNormalization(format)
  if (!certain || shelfPrice === null || shelfPrice <= 0) return {}
  return {
    normalized: { ...certain, source, shelf_price: shelfPrice },
    price_per_750: Math.round((shelfPrice / certain.divisor) * 100) / 100,
  }
}

/**
 * Applies a format a product page stated in its own headline to a listing
 * (resolve-url path and the headline read in large-format.ts): the listing is
 * flagged non-standard and, when the format is one of the three the system is
 * certain it can divide, also counted at its 750 ml-equivalent price.
 */
export function withStatedFormat<
  T extends { price: number | null; pack_quantity: number; bottle_size_ml: number | null; non_standard_format: boolean; format_label: string }
>(listing: T, format: PackFormat): T {
  return {
    ...listing,
    pack_quantity: format.pack_quantity,
    bottle_size_ml: format.bottle_size_ml,
    non_standard_format: true,
    format_label: describeFormat(format),
    ...normalizationFor(format, listing.price, 'page'),
  }
}

function formatSizeLabel(ml: number): string {
  if (ml < 1000) return `${ml}ml`
  const liters = ml / 1000
  return `${Number.isInteger(liters) ? liters : liters.toFixed(1)}L`
}

// Short, UI-facing label for the badge — "6-pack", "1.5L", "6 x 375ml".
export function describeFormat(format: PackFormat): string {
  const sizeLabel = format.bottle_size_ml != null && format.bottle_size_ml !== 750
    ? formatSizeLabel(format.bottle_size_ml)
    : null
  if (format.pack_quantity > 1 && sizeLabel) return `${format.pack_quantity} x ${sizeLabel}`
  if (format.pack_quantity > 1) return `${format.pack_quantity}-pack`
  if (sizeLabel) return sizeLabel
  return ''
}

/**
 * The format a product page states in its own headline — `<title>`,
 * `og:title` and the first `<h1>` — or null when none of them names a
 * non-standard one. Never the body: size selectors and "also available in"
 * lists there name every format the shop stocks.
 *
 * Found 2026-10-01: B-21's Google Shopping title for La Rioja Alta 904 2015
 * was "2015 La Rioja Alta Gran Reserva 904" — no size — at $199.98, so the
 * magnum went into the average as a 750ml bottle. Only the page's own
 * heading says "(1.5L)". The Shopping title is the only text a fallback
 * retailer's listing carries at fetch time; the page is first in reach when
 * its URL is resolved, which is where this is read.
 */
export function pageStatedFormat(html: string, ownNames: Array<string | null | undefined> = []): PackFormat | null {
  const pick = (re: RegExp) => {
    const m = html.match(re)
    return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
  }
  const headlines = [
    pick(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i),
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i),
    pick(/<title\b[^>]*>([\s\S]*?)<\/title>/i),
  ]
  const stated: PackFormat[] = []
  for (const text of headlines) {
    if (!text) continue
    const format = extractPackFormat(text, ownNames)
    if (isNonStandardFormat(format)) stated.push(format)
  }
  if (stated.length === 0) return null
  // Two headline elements naming different formats disagree (Phase 12.2).
  const differs = stated.some(
    f => f.pack_quantity !== stated[0].pack_quantity || f.bottle_size_ml !== stated[0].bottle_size_ml
  )
  return differs || stated.some(f => f.conflicting) ? { ...stated[0], conflicting: true } : stated[0]
}
