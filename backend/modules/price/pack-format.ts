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

function parseBottleSize(title: string): number | null {
  // Explicit metric volume: "1.5L", "1.5 L", "1.5 Liter(s)", "375ml", "750 mL"
  const literMatch = title.match(/\b(\d+(?:\.\d+)?)\s?(?:l|liters?|litres?)\b/i)
  if (literMatch) return Math.round(parseFloat(literMatch[1]) * 1000)
  const mlMatch = title.match(/\b(\d{2,5})\s?ml\b/i)
  if (mlMatch) return parseInt(mlMatch[1], 10)
  for (const [pattern, ml] of NAMED_FORMAT_ML) {
    if (pattern.test(title)) return ml
  }
  return null
}

function parsePackQuantity(title: string): number {
  const packMatch = title.match(/\b(\d{1,2})[\s-]?(?:pack|pk)\b/i)
  if (packMatch) return parseInt(packMatch[1], 10)
  const caseOfMatch = title.match(/\bcase of (\d{1,2})\b/i)
  if (caseOfMatch) return parseInt(caseOfMatch[1], 10)
  if (/\bdozen\b/i.test(title)) return 12
  if (/\bhalf[\s-]?case\b/i.test(title)) return 6
  if (/\bfull[\s-]?case\b/i.test(title)) return 12
  return 1
}

export function extractPackFormat(title: string): PackFormat {
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

  return {
    pack_quantity: parsePackQuantity(title),
    bottle_size_ml: parseBottleSize(title),
  }
}

// True when this listing is not a single standard (750ml) bottle — a
// multi-bottle pack/case, or an explicitly stated non-750ml size.
export function isNonStandardFormat(format: PackFormat): boolean {
  return format.pack_quantity !== 1 || (format.bottle_size_ml !== null && format.bottle_size_ml !== 750)
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
