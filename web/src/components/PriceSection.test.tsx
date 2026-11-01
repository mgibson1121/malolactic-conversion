import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { PriceBlock } from './PriceSection'
import { makeTestPriceData, makeTestRetailer, makeTestWine } from '../test-fixtures'

const idle: EnrichmentAction = { busy: false, error: null, cachedAt: null, run: vi.fn() }
const noop = () => {}

function renderBlock(wine = makeTestWine(), action: EnrichmentAction = idle, variant: 'card' | 'detail' | 'preview' = 'detail', lookupUnderWay = false) {
  return render(<PriceBlock wine={wine} action={action} onWineUpdated={noop} variant={variant} lookupUnderWay={lookupUnderWay} />)
}

describe('PriceBlock — Price & retailers (Phase 12.1 WI-7, D7)', () => {
  it('titles the section and its button "Price & retailers"', () => {
    renderBlock(makeTestWine({ price_data: makeTestPriceData([makeTestRetailer()]) }))
    expect(screen.getByRole('heading', { name: 'Price & retailers' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh Price & retailers' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hard refresh' })).not.toHaveTextContent(/credit/)
  })

  it('shows Avg · High · Low spelled out', () => {
    const data = makeTestPriceData([makeTestRetailer({ price: 100 }), makeTestRetailer({ slug: 'b', name: 'B', price: 140 })])
    renderBlock(makeTestWine({ price_data: data }))
    expect(screen.getByText('Avg')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(screen.queryByText('Min')).not.toBeInTheDocument()
    expect(screen.queryByText('Max')).not.toBeInTheDocument()
  })

  it('the nearest retailer is a tappable, underlined link to its page', () => {
    const r = makeTestRetailer({ name: 'Zachys', url: 'https://www.zachys.com/p/1' })
    renderBlock(makeTestWine({ price_data: makeTestPriceData([r]) }))
    const link = screen.getByRole('link', { name: 'Zachys' })
    expect(link).toHaveAttribute('href', 'https://www.zachys.com/p/1')
    expect(link.className).toMatch(/\blink\b/)
  })

  it('collapses the other retailers under "N more retailers" and expands on tap', async () => {
    const data = makeTestPriceData([
      makeTestRetailer({ slug: 'a', name: 'Nearest Shop', distance_miles: 5 }),
      makeTestRetailer({ slug: 'b', name: 'Second Shop' }),
      makeTestRetailer({ slug: 'c', name: 'Third Shop' }),
    ])
    renderBlock(makeTestWine({ price_data: data }))
    expect(screen.queryByText('Second Shop')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '2 more retailers' }))
    expect(screen.getByText('Second Shop')).toBeInTheDocument()
    expect(screen.getByText('Third Shop')).toBeInTheDocument()
  })

  it('"Your price" is the headline, marked yours; the automated figures sit under their own label', () => {
    const data = makeTestPriceData([makeTestRetailer({ price: 100 })])
    renderBlock(makeTestWine({ manual_price: 87.5, price_data: data }))
    const yours = screen.getByTestId('price-yours')
    expect(yours).toHaveTextContent('Your price (per 750 ml bottle)')
    expect(yours).toHaveTextContent('$88')
    expect(yours).toHaveTextContent('yours')
    expect(screen.getByText('Retailer prices (automated)')).toBeInTheDocument()
  })

  it('on a card, the automated figures fold away behind a summary when the price is yours', () => {
    const data = makeTestPriceData([makeTestRetailer({ price: 100 })])
    const { container } = renderBlock(makeTestWine({ manual_price: 87.5, price_data: data }), idle, 'card')
    const fold = container.querySelector('details.automated-prices-fold') as HTMLDetailsElement
    expect(fold).not.toBeNull()
    expect(fold.open).toBe(false)
  })

  it('without a manual price there is no "yours" marker', () => {
    renderBlock(makeTestWine({ price_data: makeTestPriceData([makeTestRetailer()]) }))
    expect(screen.queryByTestId('price-yours')).not.toBeInTheDocument()
    expect(screen.queryByText('Retailer prices (automated)')).not.toBeInTheDocument()
  })

  describe('listings found but none counted — the Marcoux case', () => {
    const data = makeTestPriceData(
      [
        makeTestRetailer({ slug: 'a', vintage_mismatch: true, matched_vintage: 2020, price: 68 }),
        makeTestRetailer({ slug: 'b', non_standard_format: true, bottle_size_ml: 1500, format_label: '1.5L' }),
        makeTestRetailer({ slug: 'c', link_only: true, price: null }),
      ],
      { other_vintage_price_range: { min: 68, max: 199 } }
    )

    it('says why, with counts, instead of showing dashes', () => {
      renderBlock(makeTestWine({ price_data: data }))
      expect(screen.getByText(/3 listings found, none counted toward the average/)).toBeInTheDocument()
      expect(screen.getByText(/1 other vintage \(2020\), 1 magnum, 1 search-only/)).toBeInTheDocument()
      expect(screen.queryByText('—')).not.toBeInTheDocument()
      // Recomputed over the listings shown (Phase 12.4 WI-1), not the stored range.
      expect(screen.getByText('Other vintages: $68–$68')).toBeInTheDocument()
    })

    it('prefers the sentence the backend sent', () => {
      renderBlock(makeTestWine({ price_data: data, price_exclusions: { found: 3, reasons: [], sentence: 'Backend says hi.' } }))
      expect(screen.getByText('Backend says hi.')).toBeInTheDocument()
    })
  })

  it('a sold-out listing from a price-only shop shows its price and says so (Phase 12.4 WI-2)', async () => {
    const data = makeTestPriceData([
      makeTestRetailer({ slug: 'a', name: 'A Shop', price: 100 }),
      makeTestRetailer({ slug: 'kermitlynch', name: 'Kermit Lynch Wine Merchant', price: 105, sold_out: true, is_search_results_page: false }),
    ])
    renderBlock(makeTestWine({ price_data: data }))
    await userEvent.click(screen.getByRole('button', { name: /more retailer/ }))
    expect(screen.getByText('sold out')).toBeInTheDocument()
  })

  it('lists retailers in the backend’s one order — nearest, preferred A–Z, others A–Z (Phase 12.4 WI-3)', async () => {
    const rows = [
      makeTestRetailer({ slug: 'z', name: 'Zed Shop', is_preferred_retailer: false }),
      makeTestRetailer({ slug: 'k', name: 'Kermit Lynch Wine Merchant', is_preferred_retailer: true }),
      makeTestRetailer({ slug: 'a', name: 'Astor Wines & Spirits', is_preferred_retailer: true }),
      makeTestRetailer({ slug: 'b', name: 'BlockCellar', is_preferred_retailer: false }),
    ]
    const wine = makeTestWine({
      price_data: makeTestPriceData(rows, { nearest_retailer: null }),
      price_window: { hidden: [], other_vintage_price_range: null, order: ['a', 'k', 'b', 'z'] },
    })
    const { container } = renderBlock(wine)
    await userEvent.click(screen.getByRole('button', { name: /more retailers/ }))
    const names = [...container.querySelectorAll('.retailer-list .retailer-name')].map((n) => n.textContent)
    expect(names).toEqual(['Astor Wines & Spirits', 'Kermit Lynch Wine Merchant', 'BlockCellar', 'Zed Shop'])
  })

  describe('±3-year window (Phase 12.4 WI-1)', () => {
    const wine = (retailers: ReturnType<typeof makeTestRetailer>[]) => makeTestWine({ vintage: 2012, price_data: makeTestPriceData(retailers) })

    it('shows a listing exactly 3 years away and hides one 4 years away; the stored data keeps both', async () => {
      const w = wine([
        makeTestRetailer({ slug: 'near', name: 'Near Shop', vintage_mismatch: true, matched_vintage: 2015, price: 90 }),
        makeTestRetailer({ slug: 'far', name: 'Far Shop', vintage_mismatch: true, matched_vintage: 2016, price: 300 }),
        makeTestRetailer({ slug: 'eleven', name: 'Eleven Shop', vintage_mismatch: true, matched_vintage: 2023, price: 140 }),
      ])
      renderBlock(w)
      // One row in the window, so "1 more retailer" — not 3.
      await userEvent.click(screen.getByRole('button', { name: '1 more retailer' }))
      expect(screen.getByText(/Near Shop/)).toBeInTheDocument()
      expect(screen.queryByText(/Far Shop/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Eleven Shop/)).not.toBeInTheDocument()
      expect(screen.getByText('Other vintages: $90–$90')).toBeInTheDocument()
      expect(w.price_data!.retailers).toHaveLength(3)
    })

    it('a wine whose only listings are outside the window says nothing was found, never a blank area', () => {
      renderBlock(wine([makeTestRetailer({ slug: 'eleven', name: 'Eleven Shop', vintage_mismatch: true, matched_vintage: 2023 })]))
      expect(screen.getByText(/No matching listings found/)).toBeInTheDocument()
    })
  })

  describe('four states, never a vanishing block', () => {
    it('Looking', () => {
      renderBlock(makeTestWine(), { ...idle, busy: true })
      expect(screen.getByText('Looking up prices…')).toBeInTheDocument()
    })
    it('Looking, before the first result of an automatic lookup', () => {
      renderBlock(makeTestWine(), idle, 'preview', true)
      expect(screen.getByText('Looking up prices…')).toBeInTheDocument()
    })
    it('Nothing found', () => {
      renderBlock(makeTestWine({ price_data: makeTestPriceData([]) }))
      expect(screen.getByText('No matching listings found at the configured retailers.')).toBeInTheDocument()
    })
    it('Failed, with Try again', async () => {
      const run = vi.fn()
      renderBlock(makeTestWine(), { ...idle, error: 'Price lookup failed', run })
      expect(screen.getByText(/Price lookup failed —/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(run).toHaveBeenCalled()
    })
    it('Never fetched: a plain prompt', () => {
      renderBlock(makeTestWine())
      expect(screen.getByText('No price data yet.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Fetch Price & retailers' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Hard refresh/ })).not.toBeInTheDocument()
    })
  })

  it('says when the prices were fetched for a different version of the wine', () => {
    renderBlock(makeTestWine({ price_data: makeTestPriceData([makeTestRetailer()]), enrichment_stale: { price: true, reviews: false } }))
    expect(screen.getByText(/Fetched for a different version of this wine — may not match\. Refresh\./)).toBeInTheDocument()
  })
})

describe('badge explanations (WI-8)', () => {
  async function open(r: Parameters<typeof makeTestRetailer>[0]) {
    renderBlock(makeTestWine({ price_data: makeTestPriceData([makeTestRetailer(r)]) }))
  }

  it('Verified explains itself on tap, and is honest about its scope', async () => {
    await open({ verification: 'verified' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Verified' }))
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(/opened this shop’s own search page|opened this shop's own search page/)
    expect(note).toHaveTextContent(/does not confirm the vintage or the exact bottling/)
  })

  it('Unverified explains itself', async () => {
    await open({ verification: 'unverified' })
    await userEvent.click(screen.getByRole('button', { name: 'Unverified' }))
    expect(screen.getByRole('note')).toHaveTextContent(/couldn't confirm this listing/)
  })

  it('Search only explains itself', async () => {
    await open({ link_only: true, price: null, verification: 'unchecked' })
    // No price, so it is never the nearest retailer: it lives in the collapsed list.
    await userEvent.click(screen.getByRole('button', { name: '1 more retailer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Search only' }))
    expect(screen.getByRole('note')).toHaveTextContent(/no price was found/)
  })

  it('unchecked shows no badge at all', async () => {
    await open({ verification: 'unchecked' })
    expect(screen.queryByRole('button', { name: /Verified|Unverified|Search only/ })).not.toBeInTheDocument()
  })

  it('the badges are tappable and underlined (D9)', async () => {
    await open({ verification: 'verified' })
    expect(screen.getByRole('button', { name: 'Verified' }).className).toMatch(/\blink\b/)
  })

  it('carries a legend with all three', async () => {
    await open({ verification: 'verified' })
    expect(screen.getByText('What do these badges mean?')).toBeInTheDocument()
  })
})

describe('PriceBlock — Phase 12.2 states', () => {
  it('shows a counted six-pack with both prices, a ÷6 tag, and marks the headline estimated', () => {
    const six = makeTestRetailer({
      slug: 'benchmark',
      name: 'Benchmark',
      price: 707,
      non_standard_format: true,
      pack_quantity: 6,
      format_label: '6-pack',
      normalized: { kind: 'pack', divisor: 6, source: 'title', shelf_price: 707 },
      price_per_750: 117.83,
    })
    const data = { ...makeTestPriceData([six]), price_min: 117.83, price_avg: 117.83, price_max: 117.83, headline_basis: 'single_listing' as const, headline_estimated: true }
    renderBlock(makeTestWine({ price_data: data }))
    expect(screen.getByText('÷6 pack')).toBeInTheDocument()
    expect(screen.getByText('estimated')).toBeInTheDocument()
    expect(screen.getByText(/\$707/)).toBeInTheDocument()
    expect(screen.getByText(/\$118 a bottle/)).toBeInTheDocument()
    expect(screen.getByText(/single listing, counted at a per-bottle price/)).toBeInTheDocument()
  })

  it('says a lone uncounted-size listing is unconfirmed instead of presenting it as certain', () => {
    const data = { ...makeTestPriceData([makeTestRetailer({ price: 946.32 })]), price_avg: 946.32, headline_basis: 'single_listing' as const, headline_estimated: false }
    renderBlock(makeTestWine({ price_data: data }))
    expect(screen.getByText(/single listing — size not confirmed/)).toBeInTheDocument()
  })

  it('shows both price groups and no average when the prices span 2.5x or more', () => {
    const data = {
      ...makeTestPriceData([makeTestRetailer({ price: 74.99 }), makeTestRetailer({ slug: 'b', name: 'B', price: 245 })]),
      price_min: null,
      price_avg: null,
      price_max: null,
      headline_basis: 'ambiguous' as const,
      price_groups: [
        { min: 74.99, max: 74.99, retailers: ['a'] },
        { min: 149, max: 245, retailers: ['b', 'c', 'd', 'e'] },
      ],
    }
    renderBlock(makeTestWine({ price_data: data }))
    expect(screen.getByTestId('price-groups')).toHaveTextContent('more than one bottling')
    const groups = screen.getByTestId('price-groups')
    expect(groups).toHaveTextContent('$75')
    expect(groups).toHaveTextContent('$149–$245')
    expect(screen.queryByText('Avg')).not.toBeInTheDocument()
  })
})
