import { aggregatePriceData } from './aggregate'
import { extractPackFormat, normalizationFor, certainNormalization, pageStatedFormat } from './pack-format'
import type { RetailerResult } from './types'

function listing(over: Partial<RetailerResult> & { slug: string }): RetailerResult {
  return {
    name: over.slug,
    price: 100,
    url: `https://${over.slug}.example/p`,
    is_preferred_retailer: true,
    distance_miles: 10,
    is_search_results_page: true,
    matched_vintage: 2019,
    vintage_mismatch: false,
    vintage_verdict: 'match',
    pack_quantity: 1,
    bottle_size_ml: null,
    non_standard_format: false,
    format_label: '',
    link_only: false,
    verification: 'verified',
    ...over,
  }
}

function packed(slug: string, title: string, price: number, extra: Partial<RetailerResult> = {}): RetailerResult {
  const format = extractPackFormat(title)
  return listing({
    slug,
    price,
    pack_quantity: format.pack_quantity,
    bottle_size_ml: format.bottle_size_ml,
    non_standard_format: format.pack_quantity !== 1 || (format.bottle_size_ml !== null && format.bottle_size_ml !== 750),
    ...normalizationFor(format, price, 'title'),
    ...extra,
  })
}

describe('certain formats (Phase 12.2 D7)', () => {
  it.each([
    ['2019 Wine 6-Pack', 6, 'pack'],
    ['2019 Wine Case of 12', 12, 'case'],
    ['2019 Wine 6 x 750ml', 6, 'pack'],
    ['2019 Wine Magnum 1.5L', 2, 'magnum'],
    ['2019 Wine 1.5 L', 2, 'magnum'],
    ['2019 Wine Half Case', 6, 'pack'],
  ])('%s divides by %i as a %s', (title, divisor, kind) => {
    expect(certainNormalization(extractPackFormat(title))).toEqual({ kind, divisor })
  })

  it.each([
    '2019 Wine 3-Pack',
    '2019 Wine 6 x 375ml',
    '2019 Wine 6 x Magnum 1.5L',
    '2019 Wine 3L',
    '2019 Wine Double Magnum',
    '2019 Wine 375ml',
    '2019 Wine 6-Pack Case of 12',
    '2019 Wine Magnum 750ml',
  ])('%s is not certain, so it stays excluded', title => {
    expect(certainNormalization(extractPackFormat(title))).toBeNull()
  })

  it('records shelf price, per-750 price and source', () => {
    expect(normalizationFor(extractPackFormat('Wine 6-Pack'), 707, 'page')).toEqual({
      normalized: { kind: 'pack', divisor: 6, shelf_price: 707, source: 'page' },
      price_per_750: 117.83,
    })
  })

  it('a size picker in the body never counts, only the headline elements', () => {
    const html = `<html><head><title>Domaine Marcoux 2019</title></head><body><h1>Domaine Marcoux 2019</h1>
      <select><option>750ml</option><option>Case of 6</option><option>Magnum 1.5L</option></select></body></html>`
    expect(pageStatedFormat(html)).toBeNull()
  })

  it('two headline elements naming different formats disagree, so the page is uncertain', () => {
    const html = '<title>Wine 6-Pack</title><h1>Wine Case of 12</h1>'
    const format = pageStatedFormat(html)!
    expect(format.conflicting).toBe(true)
    expect(certainNormalization(format)).toBeNull()
  })
})

describe('aggregatePriceData — Marcoux (Phase 12.2 WI-1 acceptance)', () => {
  const marcoux = [
    packed('benchmark', 'Marcoux Chateauneuf-du-Pape 2019 6-Pack', 707),
    listing({ slug: 'acker', price: 154.99, matched_vintage: 2021, vintage_mismatch: true, bottle_size_ml: 1500, non_standard_format: true, vintage_verdict: 'mismatch' }),
    listing({ slug: 'flatiron', price: 199, matched_vintage: 2016, vintage_mismatch: true, vintage_verdict: 'mismatch' }),
    listing({ slug: 'grapes', price: 67.95, matched_vintage: 2020, vintage_mismatch: true, vintage_verdict: 'mismatch' }),
    listing({ slug: 'kl', price: null, link_only: true, verification: 'unchecked' }),
  ]

  it('counts the six-pack at $117.83 a bottle and marks the headline estimated', () => {
    const r = aggregatePriceData(marcoux)
    expect(r.price_min).toBe(117.83)
    expect(r.price_avg).toBe(117.83)
    expect(r.price_max).toBe(117.83)
    expect(r.headline_basis).toBe('single_listing')
    expect(r.headline_estimated).toBe(true)
    expect(r.normalized).toBe(1)
  })

  it('reports the rest as excluded with reasons, not a row of dashes', () => {
    const r = aggregatePriceData(marcoux)
    expect(r.excluded).toEqual({
      other_vintage: 3,
      pack: 0,
      non_standard_format: 0,
      suspected_large_format: 0,
      link_only: 1,
      outside_bottling: 0,
      outlier: 0,
    })
  })
})

describe('aggregatePriceData — Vietti Barolo 2021 (WI-2 acceptance 1)', () => {
  const vietti = [
    listing({ slug: 'zachys', price: 74.99 }),
    listing({ slug: 'thatchers', price: 149 }),
    listing({ slug: 'flatiron', price: 199.99 }),
    listing({ slug: 'sokolin', price: 229 }),
    listing({ slug: 'macarthur', price: 245 }),
  ]

  it('offers no single average when counted prices span 2.5x or more, and drops nothing', () => {
    const r = aggregatePriceData(vietti)
    expect(r.headline_basis).toBe('ambiguous')
    expect(r.price_min).toBeNull()
    expect(r.price_avg).toBeNull()
    expect(r.price_max).toBeNull()
    expect(r.excluded?.outlier).toBe(0)
  })

  it('splits the groups at the largest adjacent jump, $74.99 | $149-$245', () => {
    const r = aggregatePriceData(vietti)
    expect(r.price_groups).toEqual([
      { min: 74.99, max: 74.99, retailers: ['zachys'] },
      { min: 149, max: 245, retailers: ['thatchers', 'flatiron', 'sokolin', 'macarthur'] },
    ])
  })

  it('is not ambiguous just under 2.5x', () => {
    const r = aggregatePriceData([listing({ slug: 'a', price: 100 }), listing({ slug: 'b', price: 249 })])
    expect(r.headline_basis).toBe('multiple')
    expect(r.price_groups).toBeNull()
    expect(r.price_avg).toBe(174.5)
  })

  it('measures the gap on per-750 ml prices, after normalising', () => {
    // 6-pack at $600 is $100 a bottle: not 6x a $120 bottle.
    const r = aggregatePriceData([packed('a', 'Wine 6-Pack', 600), listing({ slug: 'b', price: 120 })])
    expect(r.headline_basis).toBe('multiple')
  })

  it('still drops a single-point outlier inside a narrower spread, and counts it', () => {
    const r = aggregatePriceData([
      listing({ slug: 'a', price: 100 }),
      listing({ slug: 'b', price: 102 }),
      listing({ slug: 'c', price: 104 }),
      listing({ slug: 'd', price: 106 }),
      listing({ slug: 'e', price: 108 }),
      listing({ slug: 'f', price: 110 }),
      listing({ slug: 'g', price: 240 }),
    ])
    // 240/100 = 2.4x < 2.5x, so the ambiguity rule is not in play and the fence is.
    expect(r.headline_basis).toBe('multiple')
    expect(r.excluded?.outlier).toBe(1)
    expect(r.price_max).toBe(110)
  })
})

describe('aggregatePriceData — headline estimate', () => {
  it('is not estimated when a normalised listing sits mid-range', () => {
    const r = aggregatePriceData([
      listing({ slug: 'a', price: 100 }),
      packed('b', 'Wine 6-Pack', 750), // $125
      listing({ slug: 'c', price: 150 }),
    ])
    expect(r.price_min).toBe(100)
    expect(r.price_max).toBe(150)
    expect(r.headline_estimated).toBe(false)
  })

  it('is estimated when a normalised listing sets the max', () => {
    const r = aggregatePriceData([listing({ slug: 'a', price: 100 }), packed('b', 'Wine 6-Pack', 750)])
    expect(r.price_max).toBe(125)
    expect(r.headline_estimated).toBe(true)
  })

  it('has no basis when nothing is countable', () => {
    const r = aggregatePriceData([listing({ slug: 'a', price: 100, vintage_mismatch: true })])
    expect(r.headline_basis).toBe('none')
    expect(r.headline_estimated).toBe(false)
    expect(r.price_groups).toBeNull()
  })

  it('does not count a ratio-flagged listing and reports it', () => {
    const r = aggregatePriceData([
      listing({ slug: 'a', price: 100 }),
      listing({ slug: 'b', price: 400, suspected_large_format: true }),
    ])
    expect(r.price_max).toBe(100)
    expect(r.excluded?.suspected_large_format).toBe(1)
    expect(r.headline_basis).toBe('single_listing')
  })
})
