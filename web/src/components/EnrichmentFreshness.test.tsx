import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { WineEntry } from '@shared/types'
import { formatAge } from './EnrichmentFreshness'
import { useEnrichmentAction } from '../hooks/useEnrichmentAction'
import { EnrichmentFreshness } from './EnrichmentFreshness'
import type { EnrichmentOptions, EnrichmentResponse } from '../api'

const WINE = { id: 'wine-1' } as WineEntry

/** The button wiring both WineCard and WineDetailModal use, in isolation:
 * one click shows what is stored, a second, explicit click spends credits. */
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
      <button onClick={() => reviews.run()} disabled={reviews.busy}>
        Refresh Reviews
      </button>
      {reviews.cachedAt && (
        <EnrichmentFreshness
          fetchedAt={reviews.cachedAt}
          label="Reviews"
          onRefreshAnyway={() => reviews.run({ force: true })}
        />
      )}
      {reviews.error && <span role="alert">{reviews.error}</span>}
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

  it('offers a second, explicit click when the server returned stored data', async () => {
    const fetched_at = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ...WINE, cached: true, fetched_at })
      .mockResolvedValueOnce({ ...WINE, cached: false })
    render(<Harness fetcher={fetcher} />)

    await userEvent.click(screen.getByRole('button', { name: 'Refresh Reviews' }))
    expect(await screen.findByText(/Reviews updated 3 days ago/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh anyway' }))

    expect(fetcher).toHaveBeenNthCalledWith(2, 'wine-1', { force: true })
    // The prompt clears once the forced run has actually gone out — otherwise
    // "Refresh anyway" leaves its own prompt on screen after doing what it was
    // asked to.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Refresh anyway' })).not.toBeInTheDocument()
    )
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

    expect(await screen.findByRole('alert')).toHaveTextContent('Serper is down')
    expect(screen.queryByRole('button', { name: 'Refresh anyway' })).not.toBeInTheDocument()
  })
})
