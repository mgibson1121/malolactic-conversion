/**
 * Phase 12.1 WI-5 (D8): after a successful parse the flow shows "Scan
 * successful — pulling details" and moves on as soon as the first critic
 * score lands, or after PREVIEW_HOLD_MS (3 s) — whichever comes first.
 */
import { act, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { WineEntry } from '@shared/types'
import { LabelScanFlow } from './LabelScanFlow'
import { scanLabel, createWine, fetchWinePrice, fetchWineReviews, deleteWine } from '../api'
import { PREVIEW_HOLD_MS } from '../constants'

vi.mock('../api', () => ({
  scanLabel: vi.fn(),
  createWine: vi.fn(),
  deleteWine: vi.fn(),
  updateWine: vi.fn(),
  fetchWinePrice: vi.fn(),
  fetchWineReviews: vi.fn(),
}))

const mockScan = scanLabel as unknown as ReturnType<typeof vi.fn>
const mockCreate = createWine as unknown as ReturnType<typeof vi.fn>
const mockPrice = fetchWinePrice as unknown as ReturnType<typeof vi.fn>
const mockReviews = fetchWineReviews as unknown as ReturnType<typeof vi.fn>
const mockDelete = deleteWine as unknown as ReturnType<typeof vi.fn>

const WINE = {
  id: 'w1', producer: 'Domaine Leroy', denomination: 'Gevrey-Chambertin', vintage: 2019, region: 'Burgundy',
  quality_classification: null, vineyard: null, cuvee: null, grape_varieties: null, label_image_url: null,
  tag_discovered: false, tag_wishlist: false, tag_cellar: false, tag_consumed: false, cellar_quantity: 0,
  review_data: null, price_data: null, promoted_at: null,
} as unknown as WineEntry

const SCAN = {
  producer: 'Domaine Leroy', vintage: 2019, region: 'Burgundy', denomination: 'Gevrey-Chambertin',
  quality_classification: null, vineyard: null, cuvee: null, grape_varieties: null, wine_color: null,
  missing_tier1_fields: [], raw_response: '',
}

const scoreResult = {
  ...WINE,
  critic_summary: {
    ordered: [{
      publication: 'Vinous', score: 93, vintage: 2019, same_vintage: true, trusted: true, tier: 1,
      known_publication: true, drinking_window: null, vintage_character: null, deal: false,
    }],
  },
} as unknown as WineEntry

async function startScan() {
  render(<LabelScanFlow wines={[]} onReview={() => {}} onDone={() => {}} />)
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await act(async () => {
    const file = new File(['x'], 'label.jpg', { type: 'image/jpeg' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  // Let scan → duplicate check → createWine settle (all mocked, no timers).
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  vi.useFakeTimers()
  mockScan.mockResolvedValue(SCAN)
  mockCreate.mockResolvedValue(WINE)
  mockPrice.mockResolvedValue(WINE)
  mockDelete.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('scan interstitial (D8)', () => {
  it('uses a 3 second hold', () => {
    expect(PREVIEW_HOLD_MS).toBe(3000)
  })

  it('shows "Scan successful" with the parsed wine, then moves on after the hold when no score has landed', async () => {
    mockReviews.mockReturnValue(new Promise(() => {})) // never resolves
    await startScan()

    expect(screen.getByText('Scan successful')).toBeInTheDocument()
    expect(screen.getByText('Domaine Leroy · Gevrey-Chambertin · 2019')).toBeInTheDocument()
    expect(screen.getByText('Pulling details…')).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(PREVIEW_HOLD_MS - 1) })
    expect(screen.getByText('Scan successful')).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(2) })
    expect(screen.queryByText('Scan successful')).not.toBeInTheDocument()
    expect(screen.getByText('Scan Result')).toBeInTheDocument()
  })

  it('moves on immediately when a critic score lands before the hold ends', async () => {
    mockReviews.mockResolvedValue(scoreResult)
    await startScan()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(screen.queryByText('Scan successful')).not.toBeInTheDocument()
    expect(screen.getByText('Scan Result')).toBeInTheDocument()
  })

  it('does not move on early for a reviews result that carries no score', async () => {
    mockReviews.mockResolvedValue({ ...WINE, review_data: [] })
    await startScan()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('Scan successful')).toBeInTheDocument()
  })

  it('fires the lookups at once and does not cancel them when the hold ends', async () => {
    mockReviews.mockReturnValue(new Promise(() => {}))
    await startScan()
    expect(mockPrice).toHaveBeenCalledWith('w1')
    expect(mockReviews).toHaveBeenCalledWith('w1', { tier: 'primary' })
    await act(async () => { vi.advanceTimersByTime(PREVIEW_HOLD_MS + 10) })
    expect(mockPrice).toHaveBeenCalledTimes(1)
    expect(mockReviews).toHaveBeenCalledTimes(1)
  })

  it('a failed scan never reaches the hold', async () => {
    mockScan.mockRejectedValue(new Error('boom'))
    await startScan()
    expect(screen.getByText('Scan Failed')).toBeInTheDocument()
    expect(screen.queryByText('Scan successful')).not.toBeInTheDocument()
  })
})
