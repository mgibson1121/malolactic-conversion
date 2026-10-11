import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { WineEntry } from '@shared/types'
import { formatAge } from './EnrichmentFreshness'
import { useEnrichmentAction } from '../hooks/useEnrichmentAction'
import { EnrichmentRow } from './EnrichmentRow'
import type { EnrichmentOptions, EnrichmentResponse } from '../api'

const WINE = { id: 'wine-1' } as WineEntry

/** The button wiring every enrichment section uses, in isolation: one click
 * shows what is stored; a separate bordered Hard refresh button (Phase 12.1
 * WI-7, D6) spends credits and says how many. */
function Harness({
  fetcher,
  onWineUpdated = () => {},
}: {
  fetcher: (id: string, opts?: EnrichmentOptions) => Promise<EnrichmentResponse>
  onWineUpdated?: (wine: WineEntry) => void
}) {
  const reviews = useEnrichmentAction('wine-1', fetcher, onWineUpdated, 'Review lookup failed')
  return (
    <div>
      <EnrichmentRow
        kind="reviews"
        action={reviews}
        label="Refresh Reviews"
        busyLabel="Fetching…"
        freshnessLabel="Reviews"
        hasData
      />
    </div>
  )
}

describe('formatAge', () => {
  const now = new Date('2026-08-12T12:00:00.000Z')
  const ago = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

  it.each([
    [0, 'today'],
    [1, 'yesterday'],
    [3, '3 days ago'],
    [9, 'last week'],
    [21, '3 weeks ago'],
    [95, '3 months ago'],
  ])('renders %i days as %s', (days, expected) => {
    expect(formatAge(ago(days), now)).toBe(expected)
  })

  it('does not invent an age it cannot compute', () => {
    expect(formatAge('not a date', now)).toBe('recently')
  })
})

describe('enrichment button — cached response handling', () => {
  it('sends no force flag on the ordinary click', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ...WINE, cached: false })
    render(<Harness fetcher={fetcher} />)

    await userEvent.click(screen.getByRole('button', { name: 'Refresh Reviews' }))

    expect(fetcher).toHaveBeenCalledWith('wine-1', undefined)
  })

  it('shows a separate Hard refresh button with its credit cost, and it forces', async () => {
    const fetched_at = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ...WINE, cached: true, fetched_at })
      .mockResolvedValueOnce({ ...WINE, cached: false })
    render(<Harness fetcher={fetcher} />)

    // The cost is on the button before anything is clicked.
    const hard = screen.getByRole('button', { name: /Hard refresh/ })
    expect(hard).toHaveTextContent('about 9 credits (up to 24)')
    // The old text link is gone for good.
    expect(screen.queryByRole('button', { name: 'Refresh anyway' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh Reviews' }))
    expect(await screen.findByText(/Reviews updated 3 days ago/)).toBeInTheDocument()
    expect(fetcher).toHaveBeenNthCalledWith(1, 'wine-1', undefined)

    await userEvent.click(screen.getByRole('button', { name: /Hard refresh/ }))

    expect(fetcher).toHaveBeenNthCalledWith(2, 'wine-1', { force: true })
    // The freshness line clears once the forced run has actually gone out.
    await waitFor(() => expect(screen.queryByText(/Reviews updated/)).not.toBeInTheDocument())
  })

  it('hides Hard refresh until there is data to refresh', () => {
    function Bare() {
      const a = useEnrichmentAction('wine-1', vi.fn(), () => {}, 'x')
      return <EnrichmentRow kind="price" action={a} label="Fetch Price & retailers" busyLabel="…" freshnessLabel="Price" hasData={false} />
    }
    render(<Bare />)
    expect(screen.queryByRole('button', { name: /Hard refresh/ })).not.toBeInTheDocument()
  })

  it('states the price cost as one credit', () => {
    function Priced() {
      const a = useEnrichmentAction('wine-1', vi.fn(), () => {}, 'x')
      return <EnrichmentRow kind="price" action={a} label="Refresh Price & retailers" busyLabel="…" freshnessLabel="Price" hasData />
    }
    render(<Priced />)
    expect(screen.getByRole('button', { name: /Hard refresh/ })).toHaveTextContent('about 1 credit')
  })

  it('still updates the wine from a cached response, so the data is shown either way', async () => {
    const onWineUpdated = vi.fn()
    const cached = { ...WINE, cached: true, fetched_at: new Date().toISOString() }
    render(<Harness fetcher={vi.fn().mockResolvedValue(cached)} onWineUpdated={onWineUpdated} />)

    await userEvent.click(screen.getByRole('button', { name: 'Refresh Reviews' }))

    expect(onWineUpdated).toHaveBeenCalledWith(cached)
  })

  it('surfaces a failed run as an error rather than a freshness notice', async () => {
    render(<Harness fetcher={vi.fn().mockRejectedValue(new Error('Serper is down'))} />)

    await userEvent.click(screen.getByRole('button', { name: 'Refresh Reviews' }))

    expect(await screen.findByText('Serper is down')).toBeInTheDocument()
    expect(screen.queryByText(/Reviews updated/)).not.toBeInTheDocument()
  })
})
