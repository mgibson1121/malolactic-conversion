import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { RetailerPrice, WineEntry } from '@shared/types'
import { RetailerViewLink } from './RetailerViewLink'
import { resolveRetailerUrl } from '../api'

vi.mock('../api', () => ({
  resolveRetailerUrl: vi.fn(),
}))
const mockResolve = resolveRetailerUrl as unknown as ReturnType<typeof vi.fn>

function makeRetailer(overrides: Partial<RetailerPrice> = {}): RetailerPrice {
  return {
    slug: 'central-wine-merchants',
    name: 'Central Wine Merchants',
    price: 120,
    url: 'https://www.google.com/search?q=Central%20Wine%20Merchants',
    distance_miles: 0,
    is_preferred_retailer: false,
    is_search_results_page: true,
    matched_vintage: null,
    vintage_mismatch: false,
    vintage_verdict: 'unknown',
    pack_quantity: 1,
    bottle_size_ml: null,
    non_standard_format: false,
    format_label: '',
    link_only: false,
    verification: 'unchecked',
    ...overrides,
  }
}

function fakeTab() {
  return { location: { href: '' } } as unknown as Window
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('RetailerViewLink — retailer that does not need resolution', () => {
  it('renders a plain link and never calls resolveRetailerUrl', async () => {
    const openSpy = vi.spyOn(window, 'open')
    render(
      <RetailerViewLink
        wineId="wine-1"
        retailer={makeRetailer({ url: 'https://www.kandlwines.example/search?q=x' })}
        onWineUpdated={() => {}}
      />
    )

    await userEvent.click(screen.getByRole('link', { name: 'View' }))

    expect(mockResolve).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })
})

describe('RetailerViewLink — an unresolved fallback link', () => {
  it('opens a blank tab synchronously, then points it at the resolved product page', async () => {
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab)
    const onWineUpdated = vi.fn()
    const retailer = makeRetailer()
    const updatedWine = {
      price_data: {
        retailers: [{ ...retailer, url: 'https://www.centralwinemerchants.com/p/1', is_search_results_page: false }],
      },
    } as unknown as WineEntry
    mockResolve.mockResolvedValue(updatedWine)

    render(<RetailerViewLink wineId="wine-1" retailer={retailer} onWineUpdated={onWineUpdated} />)
    await userEvent.click(screen.getByRole('link', { name: 'View' }))
    await vi.waitFor(() => expect(tab.location.href).toBe('https://www.centralwinemerchants.com/p/1'))

    expect(mockResolve).toHaveBeenCalledWith('wine-1', 'central-wine-merchants')
    expect(onWineUpdated).toHaveBeenCalledWith(updatedWine)
  })

  it('falls back to the original Google search when resolution fails', async () => {
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab)
    const retailer = makeRetailer()
    mockResolve.mockRejectedValue(new Error('network error'))

    render(<RetailerViewLink wineId="wine-1" retailer={retailer} onWineUpdated={() => {}} />)
    await userEvent.click(screen.getByRole('link', { name: 'View' }))

    await vi.waitFor(() => expect(tab.location.href).toBe(retailer.url))
  })

  // The click must never be blocked past the timeout, even if the server
  // never answers.
  it('falls back to the Google search once the resolve call exceeds the timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab)
    const retailer = makeRetailer()
    mockResolve.mockReturnValue(new Promise(() => {})) // never resolves

    render(<RetailerViewLink wineId="wine-1" retailer={retailer} onWineUpdated={() => {}} />)
    await userEvent.setup({ delay: null }).click(screen.getByRole('link', { name: 'View' }))

    await vi.advanceTimersByTimeAsync(3000)

    expect(tab.location.href).toBe(retailer.url)
  })

  it('does nothing further when the popup is blocked, rather than throwing', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const retailer = makeRetailer()

    render(<RetailerViewLink wineId="wine-1" retailer={retailer} onWineUpdated={() => {}} />)

    await expect(userEvent.click(screen.getByRole('link', { name: 'View' }))).resolves.not.toThrow()
    expect(mockResolve).not.toHaveBeenCalled()
  })
})
