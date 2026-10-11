import { checkHeadlineFormats, MAX_PAGE_READS } from './large-format'
import { aggregatePriceData } from './aggregate'
import type { RetailerResult } from './types'

function listing(over: Partial<RetailerResult> & { slug: string }): RetailerResult {
  return {
    name: over.slug,
    price: 100,
    url: `https://${over.slug}.example/products/wine`,
    is_preferred_retailer: true,
    distance_miles: 10,
    is_search_results_page: false,
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

const page = (headline: string) => `<html><head><title>${headline}</title></head><body><h1>${headline}</h1>
  <select><option>750ml</option><option>Case of 6</option></select></body></html>`

const renderWith = (html: string | null) => jest.fn(async (_url: string) => html)

describe('checkHeadlineFormats — the listing that drives the headline (Phase 12.2 WI-3)', () => {
  it('Pavillon: a lone $946.32 listing whose page says 6-pack counts at $157.72, estimated', async () => {
    const saratoga = listing({ slug: 'saratoga', price: 946.32 })
    const render = renderWith(page('Domaine du Pavillon Pommard 1er Cru Les Rugiens 2019 6-Pack'))
    const out = await checkHeadlineFormats([saratoga], ['Domaine du Pavillon'], render)
    const agg = aggregatePriceData(out)
    expect(out[0].price).toBe(946.32)
    expect(out[0].price_per_750).toBe(157.72)
    expect(out[0].normalized?.source).toBe('page')
    expect(agg.price_avg).toBe(157.72)
    expect(agg.headline_basis).toBe('single_listing')
    expect(agg.headline_estimated).toBe(true)
  })

  it('a lone listing whose page states nothing stays counted, resting on a single listing', async () => {
    const out = await checkHeadlineFormats([listing({ slug: 'saratoga', price: 946.32 })], [], renderWith(page('Pavillon Pommard 2019')))
    const agg = aggregatePriceData(out)
    expect(agg.price_avg).toBe(946.32)
    expect(agg.headline_basis).toBe('single_listing')
    expect(agg.headline_estimated).toBe(false)
  })

  it('a size picker in the body never normalises', async () => {
    const out = await checkHeadlineFormats([listing({ slug: 'a', price: 500 })], [], renderWith(page('Some Wine 2019')))
    expect(out[0].normalized).toBeUndefined()
  })

  it('does not render a constructed search-results page', async () => {
    const render = renderWith(page('Wine 6-Pack'))
    const out = await checkHeadlineFormats([listing({ slug: 'a', price: 500, is_search_results_page: true })], [], render)
    expect(render).not.toHaveBeenCalled()
    expect(out[0].normalized).toBeUndefined()
  })

  it('a failed render changes nothing', async () => {
    const out = await checkHeadlineFormats([listing({ slug: 'a', price: 500 })], [], renderWith(null))
    expect(out[0]).toEqual(listing({ slug: 'a', price: 500 }))
  })
})

describe('checkHeadlineFormats — the price-ratio trigger (D11)', () => {
  const comparables = [
    listing({ slug: 'a', price: 100, is_search_results_page: true }),
    listing({ slug: 'b', price: 110, is_search_results_page: true }),
    listing({ slug: 'c', price: 120, is_search_results_page: true }),
  ]

  it('an expensive listing whose page states a case is divided and counted', async () => {
    const dear = listing({ slug: 'dear', price: 1200 })
    const out = await checkHeadlineFormats([...comparables, dear], [], renderWith(page('Wine Case of 12')))
    expect(out[3].price_per_750).toBe(100)
    expect(out[3].suspected_large_format).toBeUndefined()
  })

  it('states nothing: left out of the average and labelled, not rejected', async () => {
    const dear = listing({ slug: 'dear', price: 300 })
    const out = await checkHeadlineFormats([...comparables, dear], [], renderWith(page('Wine 2019')))
    expect(out[3].suspected_large_format).toBe(true)
    const agg = aggregatePriceData(out)
    expect(agg.price_max).toBe(120)
    expect(agg.excluded?.suspected_large_format).toBe(1)
  })

  it('an unreadable page (search url) is treated as nothing stated', async () => {
    const dear = listing({ slug: 'dear', price: 300, is_search_results_page: true })
    const out = await checkHeadlineFormats([...comparables, dear], [], renderWith(null))
    expect(out[3].suspected_large_format).toBe(true)
  })

  it('never fires with fewer than three other comparable listings', async () => {
    const out = await checkHeadlineFormats(
      [comparables[0], comparables[1], listing({ slug: 'dear', price: 400, is_search_results_page: true })],
      [],
      renderWith(null)
    )
    expect(out.some(r => r.suspected_large_format)).toBe(false)
  })

  it('does not fire at 1.5x the median', async () => {
    const mid = listing({ slug: 'mid', price: 165, is_search_results_page: true })
    const out = await checkHeadlineFormats([...comparables, mid], [], renderWith(null))
    expect(out.some(r => r.suspected_large_format)).toBe(false)
  })

  it('Vietti: $245 against a $176 median is under 1.75x, so nothing is flagged and the 2.5x rule decides', async () => {
    const vietti = [74.99, 149, 199.99, 229, 245].map((p, i) => listing({ slug: `s${i}`, price: p, is_search_results_page: true }))
    const out = await checkHeadlineFormats(vietti, [], renderWith(null))
    expect(out.some(r => r.suspected_large_format)).toBe(false)
    expect(aggregatePriceData(out).headline_basis).toBe('ambiguous')
  })

  it('caps page renders per fetch', async () => {
    const all = [100, 101, 102, 103, 104].map((p, i) => listing({ slug: `x${i}`, price: p }))
    const render = renderWith(page('Wine 2019'))
    await checkHeadlineFormats([...all, listing({ slug: 'd1', price: 400 }), listing({ slug: 'd2', price: 410 })], [], render)
    expect(render.mock.calls.length).toBeLessThanOrEqual(MAX_PAGE_READS)
  })
})
