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

  it('one line for a priced wine: the average, and the range (Phase 12.5 WI-1)', () => {
    const data = makeTestPriceData([makeTestRetailer({ price: 100 }), makeTestRetailer({ slug: 'b', name: 'B', price: 140 })])
    renderBlock(makeTestWine({ price_data: data }))
    const line = screen.getByTestId('price-state-line')
    expect(line).toHaveTextContent('$120 avg · $100–$140')
    expect(screen.queryByText('Avg')).not.toBeInTheDocument()
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
      expect(w.price_data!.retailers).toHaveLength(3)
    })

    it('a wine whose only listings are outside the window says nothing was found, never a blank area', () => {
      renderBlock(wine([makeTestRetailer({ slug: 'eleven', name: 'Eleven Shop', vintage_mismatch: true, matched_vintage: 2023 })]))
      expect(screen.getByTestId('price-state-line')).toHaveTextContent('No prices found')
    })
  })

  describe('the price state model (Phase 12.5 WI-1): one line per state, never a vanishing block', () => {
    const line = () => screen.getByTestId('price-state-line')
    const priced = (r: Parameters<typeof makeTestRetailer>[0] = {}) => makeTestRetailer({ price: 100, ...r })

    it('Looking', () => {
      renderBlock(makeTestWine(), { ...idle, busy: true })
      expect(screen.getByText('Checking prices…')).toBeInTheDocument()
    })
    it('Looking, before the first result of an automatic lookup', () => {
      renderBlock(makeTestWine(), idle, 'preview', true)
      expect(screen.getByText('Checking prices…')).toBeInTheDocument()
    })
    it('Priced, with Exact match when a listing is the exact wine and vintage', () => {
      renderBlock(makeTestWine({ price_data: makeTestPriceData([priced({ vintage_verdict: 'match', bottling_difference: { extra: [], missing: [] } })]) }))
      expect(line()).toHaveTextContent('$100 avg')
      expect(line()).toHaveTextContent('Exact match')
    })
    it('Priced, no badge when the vintage is unconfirmed (WI-4)', () => {
      renderBlock(makeTestWine({ price_data: makeTestPriceData([priced({ vintage_verdict: 'unknown', matched_vintage: null })]) }))
      expect(line()).toHaveTextContent('$100 avg')
      expect(screen.queryByText('Exact match')).not.toBeInTheDocument()
    })
    it('Estimated', () => {
      renderBlock(makeTestWine({ price_data: { ...makeTestPriceData([priced()]), headline_estimated: true } }))
      expect(line()).toHaveTextContent('$100 avg · est.')
    })
    it('Wide range: both groups, no average', () => {
      const data = {
        ...makeTestPriceData([priced({ price: 74.99 }), priced({ slug: 'b', name: 'B', price: 245 })]),
        price_min: null, price_avg: null, price_max: null, headline_basis: 'ambiguous' as const,
        price_groups: [{ min: 74.99, max: 74.99, retailers: ['a'] }, { min: 149, max: 245, retailers: ['b', 'c'] }],
      }
      renderBlock(makeTestWine({ price_data: data }))
      expect(line()).toHaveTextContent('Prices vary widely')
      expect(screen.getByTestId('price-groups')).toHaveTextContent('$149–$245')
    })
    it('Similar vintages: only other vintages within ±3, each row tagged with its year (the Gigondas case)', async () => {
      // Saint-Damien Gigondas 2019: Zachys has the 2022 magnum. 3 years is inside the window.
      const data = makeTestPriceData([priced({ slug: 'zachys', name: 'Zachys', vintage_mismatch: true, matched_vintage: 2022, price: 79.99 }), priced({ slug: 'kl', name: 'K&L', price: null, link_only: true })])
      renderBlock(makeTestWine({ vintage: 2019, price_data: data }))
      expect(line()).toHaveTextContent('Similar vintages')
      await userEvent.click(screen.getByRole('button', { name: '1 more retailer' }))
      expect(screen.getByText('2022 vintage')).toBeInTheDocument()
      // The search-only K&L link is not in the price list (WI-2).
      expect(screen.queryByText('K&L')).not.toBeInTheDocument()
    })
    it('No average: listings with prices, none countable', () => {
      renderBlock(makeTestWine({ price_data: makeTestPriceData([priced({ non_standard_format: true, bottle_size_ml: 1500, format_label: '1.5L' })]) }))
      expect(line()).toHaveTextContent('Prices found, no average')
    })
    it('Nothing found', () => {
      renderBlock(makeTestWine({ price_data: makeTestPriceData([]) }))
      expect(line()).toHaveTextContent('No prices found')
    })
    it('Nothing found when the only entry is a search link (it lives under Trusted Retailers, WI-2)', () => {
      renderBlock(makeTestWine({ price_data: makeTestPriceData([priced({ price: null, link_only: true })]) }))
      expect(line()).toHaveTextContent('No prices found')
    })
    it('Failed, neutral, with Retry', async () => {
      const run = vi.fn()
      renderBlock(makeTestWine(), { ...idle, error: 'Price lookup failed', run })
      expect(screen.getByText(/Couldn’t check prices/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(run).toHaveBeenCalled()
    })
    it('no price block says "listings", "counted" or "none counted toward"', () => {
      const { container } = renderBlock(makeTestWine({ price_data: makeTestPriceData([priced({ non_standard_format: true, format_label: '1.5L' })]) }))
      expect(container.textContent).not.toMatch(/listings|counted|none counted toward/i)
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

describe('PriceBlock — Phase 12.2 formats, under the 12.5 state model', () => {
  it('a counted six-pack shows both prices and a ÷6 tag, and the line says est.', () => {
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
    expect(screen.getByTestId('price-state-line')).toHaveTextContent('$118 avg · est.')
    expect(screen.getByText(/\$707/)).toBeInTheDocument()
    expect(screen.getByText(/\$118 a bottle/)).toBeInTheDocument()
  })
})
