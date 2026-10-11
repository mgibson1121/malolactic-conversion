import {
  GENERIC_BOTTLING_WORDS,
  STOPWORDS,
  bottlingNameWords,
  normalize,
  significantWords,
  stripLegalForm,
  tokenSet,
  type WineIdentity,
} from './wine-match'

/**
 * Modifiers count in both directions (Phase 12.2 D8, WI-2).
 *
 * A wine recorded without a vineyard or cuvée is the plain bottling; a wine
 * recorded with one is that bottling. A candidate that **adds** a naming word
 * the wine never claimed (Vietti's plain Barolo against a *Monvigliero* page)
 * is evidence of a different bottling, and so is one that **omits** a naming
 * word the wine does record. Both are labelled and ranked — never silently
 * matched, never rejected (rejection stays name-only, CLAUDE.md §5, and a
 * candidate that differs this way is still a producer/denomination/vintage
 * match). Fixed rules decide here; the model only ever reports which name a
 * page's wine bears (`pageBottling`), as a fact.
 *
 * Tier words (Gran Reserva, Riserva, Selección Especial …) stay lenient — they
 * confirm and never reject (PR #40) — but a candidate that omits or adds one
 * is noted (D13), as `tierNote`.
 */
export interface BottlingDifference {
  /** Naming words the candidate carries that the wine does not, in order of appearance. */
  extra: string[]
  /** Naming words the wine records that the candidate does not carry. */
  missing: string[]
  /** "Gran Reserva" / "Riserva" … omitted or added; labelled, never a rejection. */
  tierNote: string | null
}

export const NO_DIFFERENCE: BottlingDifference = { extra: [], missing: [], tierNote: null }

export function isExactBottling(d: BottlingDifference | null | undefined): boolean {
  return !d || (d.extra.length === 0 && d.missing.length === 0)
}

/**
 * Descriptors that commonly mark a *separate* cuvée at a different price —
 * "Vieilles Vignes" on a Châteauneuf, "Prestige" on a Champagne house. They
 * sit in GENERIC_BOTTLING_WORDS for the rejection rule (a shop may drop them),
 * but as modifiers they count in both directions. A short seed list; the
 * developer reviews it (spec §8 Q3). Whether a descriptor names a different
 * wine is region- and producer-dependent, which is why this is data, not a
 * global yes/no.
 */
export const SEPARATE_CUVEE_WORDS = new Set(['vieilles', 'vieille', 'vignes', 'prestige', 'barrique'])

/** Tier words: lenient but labelled. */
const TIER_WORDS = new Set([
  'gran', 'grande', 'reserva', 'riserva', 'reserve', 'seleccion', 'selezione', 'selection', 'especial', 'speciale', 'superiore', 'classico',
])

/**
 * Words in a product title or slug that are not a bottling name: how shops
 * describe colour, format, grapes, places and the page itself. Conservative on
 * purpose — an extra word moves a page down a rung of the ladder, so a
 * false "extra" costs more than a missed one.
 */
const NOT_A_BOTTLING_NAME = new Set([
  // commerce and page furniture
  'wine', 'wines', 'bottle', 'bottles', 'product', 'products', 'shop', 'store', 'buy', 'price', 'item', 'items', 'details', 'detail',
  'html', 'htm', 'php', 'aspx', 'collections', 'collection', 'catalog', 'catalogue', 'sku', 'srsltid', 'option', 'review', 'reviews',
  'productreviews', 'sale', 'offer', 'offers', 'online', 'fine', 'rare', 'limited', 'edition', 'gift', 'stock', 'available', 'list', 'view', 'page', 'index',
  // format
  'ml', 'liter', 'liters', 'litre', 'litres', 'magnum', 'bottled', 'case', 'pack', 'half', 'standard', 'single', 'dozen',
  // appellation-quality codes
  'docg', 'doca', 'aoc', 'aop', 'igp', 'igt', 'vdlt', 'vdp', 'vino',
  // colour and style
  'red', 'white', 'rose', 'rosso', 'rouge', 'blanc', 'bianco', 'tinto', 'blanco', 'rosado', 'sparkling', 'still', 'dry', 'sweet', 'brut', 'nature', 'organic', 'biodynamic',
  // grapes
  'nebbiolo', 'sangiovese', 'barbera', 'dolcetto', 'corvina', 'rondinella', 'molinara', 'merlot', 'cabernet', 'sauvignon', 'franc', 'syrah', 'shiraz', 'grenache',
  'mourvedre', 'pinot', 'noir', 'gris', 'grigio', 'chardonnay', 'riesling', 'chenin', 'semillon', 'viognier', 'tempranillo', 'garnacha', 'malbec', 'zinfandel', 'gamay',
  'cinsault', 'carignan', 'aglianico', 'nero', 'avola', 'verdicchio', 'trebbiano', 'garganega', 'albarino', 'verdejo', 'gruner', 'veltliner', 'muscat', 'moscato',
  // countries and regions
  'france', 'french', 'italy', 'italian', 'spain', 'spanish', 'germany', 'german', 'portugal', 'austria', 'usa', 'california', 'oregon', 'napa', 'sonoma', 'australia',
  'burgundy', 'bourgogne', 'bordeaux', 'rhone', 'loire', 'alsace', 'champagne', 'provence', 'languedoc', 'roussillon', 'beaujolais', 'jura', 'savoie',
  'piedmont', 'piemonte', 'tuscany', 'toscana', 'veneto', 'sicily', 'sicilia', 'rioja', 'ribera', 'duero', 'priorat', 'mosel', 'rheingau', 'cotes', 'cote',
  'langhe', 'montalcino', 'valpolicella', 'barolo', 'barbaresco', 'chianti', 'brunello', 'amarone', 'classico',
])

export interface BottlingCandidate {
  title?: string | null
  /** Product URL: its path slug carries the wine's name. Host and query are ignored. */
  url?: string | null
  /** The vineyard/cuvée/special-bottling name the rendered page's wine bears
   * (GPT-4o reports it as a fact), when a page was read. */
  pageBottling?: string | null
}

/** The wine fields this judgement needs. Region and grapes are ignored as naming words. */
export interface BottlingWine extends WineIdentity {
  region?: string | null
  grape_varieties?: string[] | null
  /** The developer's answer "Plain / no special bottling": nothing the wine
   * records is a modifier, and any word a candidate adds is a different bottling. */
  bottling_plain?: boolean | null
}

function slugWords(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const path = decodeURIComponent(new URL(url).pathname)
    return path.replace(/\.[a-z]{2,5}$/i, ' ').replace(/[/_-]+/g, ' ')
  } catch {
    return ''
  }
}

const unique = (words: string[]) => [...new Set(words)]

/**
 * What a candidate page says about the wine's bottling relative to the wine as
 * recorded. Pure, free and re-runnable: because the verdict is derived from
 * the stored URL/title and the wine's *current* identity, answering "Which
 * bottling is yours?" re-scores every stored candidate with no network call.
 */
export function bottlingDifference(candidate: BottlingCandidate, wine: BottlingWine): BottlingDifference {
  const text = `${candidate.title ?? ''} ${slugWords(candidate.url)}`
  const candidateTokens = tokenSet(`${text} ${candidate.pageBottling ?? ''}`)

  const wineNaming = unique([
    ...bottlingNameWords(wine.cuvee ?? ''),
    ...bottlingNameWords(wine.vineyard ?? ''),
    ...significantWords(`${wine.cuvee ?? ''} ${wine.vineyard ?? ''}`).filter(w => SEPARATE_CUVEE_WORDS.has(w)),
  ])

  // Words that already belong to the wine's own identity are never "extra".
  const own = new Set<string>([
    ...significantWords(stripLegalForm(wine.producer)),
    ...significantWords(wine.denomination),
    ...significantWords(wine.quality_classification ?? ''),
    ...significantWords(wine.region ?? ''),
    ...(wine.grape_varieties ?? []).flatMap(g => significantWords(g)),
    ...wineNaming,
  ])
  const ownTokens = new Set([...own].flatMap(w => [w, w.endsWith('s') ? w.slice(0, -1) : `${w}s`]))

  const extra: string[] = []
  const seenSingular = new Set<string>()
  for (const raw of normalize(`${text} ${candidate.pageBottling ?? ''}`).split(/\s+/)) {
    if (raw.length < 4 || /\d/.test(raw)) continue
    if (ownTokens.has(raw) || STOPWORDS.has(raw) || NOT_A_BOTTLING_NAME.has(raw)) continue
    if (GENERIC_BOTTLING_WORDS.has(raw) && !SEPARATE_CUVEE_WORDS.has(raw)) continue
    const singular = raw.endsWith('s') && raw.length > 5 ? raw.slice(0, -1) : raw
    if (seenSingular.has(singular)) continue
    seenSingular.add(singular)
    extra.push(raw)
  }

  const missing = wine.bottling_plain ? [] : wineNaming.filter(w => !candidateTokens.has(w))

  // Tier words: lenient, but a difference is noted (D13).
  const wineTier = unique(
    significantWords(`${wine.cuvee ?? ''} ${wine.vineyard ?? ''} ${wine.quality_classification ?? ''}`).filter(w => TIER_WORDS.has(w))
  )
  const candTier = unique([...candidateTokens].filter(w => TIER_WORDS.has(w)))
  const omitted = wineTier.filter(w => !candidateTokens.has(w))
  const added = candTier.filter(w => !tokenSet(wineTier.join(' ')).has(w))
  const tierNote =
    omitted.length > 0 && candTier.length === 0
      ? `Doesn't say ${title(omitted)}`
      : added.length > 0 && wineTier.length === 0
        ? `Says ${title(added)}`
        : null

  return { extra, missing, tierNote }
}

function title(words: string[]): string {
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** "Monvigliero", "Vieilles Vignes": a candidate's extra words as the modifier they name. */
export function modifierName(extra: string[]): string {
  return title(extra)
}

/** The badge a row carries, in either direction (spec WI-2.2). */
export function bottlingBadge(d: BottlingDifference): string | null {
  if (d.extra.length > 0) return `Names ${modifierName(d.extra)} — yours doesn't`
  if (d.missing.length > 0) return `Doesn't name ${modifierName(d.missing)} — yours does`
  return null
}

/** The fields a bottling judgement reads, from a wine (or a database row). */
export function bottlingWineOf(wine: {
  producer: string | null
  denomination: string | null
  vintage: number | null
  cuvee: string | null
  vineyard: string | null
  quality_classification: string | null
  region?: string | null
  grape_varieties?: string[] | null
  bottling_plain?: boolean | null
}): BottlingWine {
  return {
    producer: wine.producer ?? '',
    denomination: wine.denomination ?? '',
    vintage: wine.vintage,
    cuvee: wine.cuvee,
    vineyard: wine.vineyard,
    quality_classification: wine.quality_classification,
    region: wine.region ?? null,
    grape_varieties: wine.grape_varieties ?? null,
    bottling_plain: wine.bottling_plain ?? null,
  }
}
