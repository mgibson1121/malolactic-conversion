import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { WineEntry } from '@shared/types'
import { LabelScanFlow } from './LabelScanFlow'
import { scanLabel, createWine, deleteWine, updateWine, fetchWinePrice, fetchWineReviews } from '../api'
import type { LabelScanResult } from '../api'

vi.mock('../api', () => ({
  scanLabel: vi.fn(),
  createWine: vi.fn(),
  deleteWine: vi.fn(),
  updateWine: vi.fn(),
  fetchWinePrice: vi.fn(),
  fetchWineReviews: vi.fn(),
}))

const mockScanLabel = scanLabel as unknown as ReturnType<typeof vi.fn>
const mockCreateWine = createWine as unknown as ReturnType<typeof vi.fn>
const mockDeleteWine = deleteWine as unknown as ReturnType<typeof vi.fn>
const mockUpdateWine = updateWine as unknown as ReturnType<typeof vi.fn>
const mockFetchPrice = fetchWinePrice as unknown as ReturnType<typeof vi.fn>
const mockFetchReviews = fetchWineReviews as unknown as ReturnType<typeof vi.fn>

function makeScan(overrides: Partial<LabelScanResult> = {}): LabelScanResult {
  return {
    producer: 'Domaine Leroy',
    vintage: 2019,
    region: 'Burgundy',
    denomination: 'Gevrey-Chambertin',
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    grape_varieties: ['Pinot Noir'],
    missing_tier1_fields: [],
    raw_response: '',
    ...overrides,
  }
}

function makeWine(overrides: Partial<WineEntry> = {}): WineEntry {
  return {
    id: 'wine-1',
    producer: 'Domaine Leroy',
    denomination: 'Gevrey-Chambertin',
    vintage: 2019,
    region: 'Burgundy',
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    grape_varieties: ['Pinot Noir'],
    label_image_url: null,
    tag_discovered: false,
    tag_wishlist: false,
    tag_cellar: false,
    tag_consumed: false,
    cellar_quantity: 0,
    cellar_category: null,
    drinking_window: null,
    vintage_rating: null,
    my_rating: null,
    my_tags: [],
    latest_tasting_note_id: null,
    wishlist_notes: null,
    price_paid: null,
    purchased_from: null,
    date_added: '2026-08-19T00:00:00.000Z',
    date_first_consumed: null,
    advice_linked: null,
    price_data: null,
    retailer_links: null,
    review_data: null,
    review_probe_log: null,
    promoted_at: null,
    ...overrides,
  } as WineEntry
}

async function uploadAFile() {
  const file = new File(['x'], 'label.jpg', { type: 'image/jpeg' })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await userEvent.upload(input, file)
}

beforeEach(() => {
  mockFetchPrice.mockResolvedValue(makeWine({ price_data: null }))
  mockFetchReviews.mockResolvedValue(makeWine({ review_data: [] }))
  mockDeleteWine.mockResolvedValue(undefined)
  mockUpdateWine.mockImplementation(async (id: string, edits: Partial<WineEntry>) =>
    makeWine({ id, ...edits })
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LabelScanFlow — draft creation on parse (WI-1)', () => {
  it('creates the wine row immediately once scanning resolves, before Continue is clicked', async () => {
    mockScanLabel.mockResolvedValue(makeScan())
    mockCreateWine.mockResolvedValue(makeWine())

    render(<LabelScanFlow wines={[]} onReview={() => {}} onDone={() => {}} />)
    await uploadAFile()

    await waitFor(() => expect(mockCreateWine).toHaveBeenCalled())
    expect(mockCreateWine.mock.calls[0][0]).toMatchObject({
      producer: 'Domaine Leroy',
      denomination: 'Gevrey-Chambertin',
      tag_discovered: false,
      tag_wishlist: false,
      tag_cellar: false,
    })
  })

  it('fires price and primary-tier reviews as soon as the draft is created (WI-6)', async () => {
    mockScanLabel.mockResolvedValue(makeScan())
    mockCreateWine.mockResolvedValue(makeWine())

    render(<LabelScanFlow wines={[]} onReview={() => {}} onDone={() => {}} />)
    await uploadAFile()

    await waitFor(() => expect(mockFetchPrice).toHaveBeenCalledWith('wine-1', undefined))
    expect(mockFetchReviews).toHaveBeenCalledWith('wine-1', { tier: 'primary' })
  })

  it('holds the fetch when Tier 1 is incomplete (missing producer)', async () => {
    mockScanLabel.mockResolvedValue(makeScan({ producer: null, missing_tier1_fields: ['producer'] }))
    mockCreateWine.mockResolvedValue(makeWine({ producer: null }))

    render(<LabelScanFlow wines={[]} onReview={() => {}} onDone={() => {}} />)
    await uploadAFile()

    await waitFor(() => expect(mockCreateWine).toHaveBeenCalled())
    expect(mockFetchPrice).not.toHaveBeenCalled()
    expect(mockFetchReviews).not.toHaveBeenCalled()
  })

  it('fires on Continue once the missing field is filled in', async () => {
    mockScanLabel.mockResolvedValue(makeScan({ producer: null, missing_tier1_fields: ['producer'] }))
    mockCreateWine.mockResolvedValue(makeWine({ producer: null }))
    mockUpdateWine.mockResolvedValue(makeWine({ producer: 'Domaine Leroy' }))

    render(<LabelScanFlow wines={[]} onReview={() => {}} onDone={() => {}} />)
    await uploadAFile()
    await waitFor(() => expect(mockCreateWine).toHaveBeenCalled())

    await userEvent.type(screen.getByPlaceholderText('e.g. Domaine Leroy'), 'Domaine Leroy')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(mockFetchReviews).toHaveBeenCalledWith('wine-1', { force: false, tier: 'primary' })
    )
  })
})

describe('LabelScanFlow — free duplicate check (WI-4)', () => {
  it('never creates a row or fetches anything when a confident duplicate is found', async () => {
    const existing = makeWine({ id: 'existing-1', promoted_at: '2026-08-01T00:00:00.000Z' })
    mockScanLabel.mockResolvedValue(makeScan())

    render(<LabelScanFlow wines={[existing]} onReview={() => {}} onDone={() => {}} />)
    await uploadAFile()

    await waitFor(() => expect(screen.getByText('Already in Your Collection')).toBeInTheDocument())
    expect(mockCreateWine).not.toHaveBeenCalled()
    expect(mockFetchPrice).not.toHaveBeenCalled()
    expect(mockFetchReviews).not.toHaveBeenCalled()
  })

  it('routes to the existing wine without auto-firing reviews', async () => {
    const existing = makeWine({ id: 'existing-1', promoted_at: '2026-08-01T00:00:00.000Z' })
    mockScanLabel.mockResolvedValue(makeScan())
    const onReview = vi.fn()

    render(<LabelScanFlow wines={[existing]} onReview={onReview} onDone={() => {}} />)
    await uploadAFile()
    await userEvent.click(await screen.findByRole('button', { name: 'View Existing Wine' }))

    expect(onReview).toHaveBeenCalledWith(existing, false)
  })

  it('"add anyway" falls through to normal draft creation', async () => {
    const existing = makeWine({ id: 'existing-1', promoted_at: '2026-08-01T00:00:00.000Z' })
    mockScanLabel.mockResolvedValue(makeScan())
    mockCreateWine.mockResolvedValue(makeWine({ id: 'new-wine' }))

    render(<LabelScanFlow wines={[existing]} onReview={() => {}} onDone={() => {}} />)
    await uploadAFile()
    await userEvent.click(await screen.findByRole('button', { name: /different bottle/i }))

    await waitFor(() => expect(mockCreateWine).toHaveBeenCalled())
  })

  it('a vintage mismatch does not short-circuit — it creates a draft with a notice', async () => {
    const existing = makeWine({ id: 'existing-1', vintage: 2021, promoted_at: '2026-08-01T00:00:00.000Z' })
    mockScanLabel.mockResolvedValue(makeScan({ vintage: 2019 }))
    mockCreateWine.mockResolvedValue(makeWine({ vintage: 2019 }))

    render(<LabelScanFlow wines={[existing]} onReview={() => {}} onDone={() => {}} />)
    await uploadAFile()

    await waitFor(() => expect(mockCreateWine).toHaveBeenCalled())
    expect(screen.getByText(/You already have the 2021/)).toBeInTheDocument()
  })
})

describe('LabelScanFlow — discard on cancel/retry (WI-7)', () => {
  it('discards the created draft when Cancel is clicked from the review screen', async () => {
    mockScanLabel.mockResolvedValue(makeScan())
    mockCreateWine.mockResolvedValue(makeWine())
    const onDone = vi.fn()

    render(<LabelScanFlow wines={[]} onReview={() => {}} onDone={onDone} />)
    await uploadAFile()
    await waitFor(() => expect(mockCreateWine).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: '✕' }))

    await waitFor(() => expect(mockDeleteWine).toHaveBeenCalledWith('wine-1'))
    expect(onDone).toHaveBeenCalled()
  })

  it('discards the created draft when Scan Again is clicked', async () => {
    mockScanLabel.mockResolvedValue(makeScan())
    mockCreateWine.mockResolvedValue(makeWine())

    render(<LabelScanFlow wines={[]} onReview={() => {}} onDone={() => {}} />)
    await uploadAFile()
    await waitFor(() => expect(mockCreateWine).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Scan Again' }))

    await waitFor(() => expect(mockDeleteWine).toHaveBeenCalledWith('wine-1'))
    expect(screen.getByText('Scan Wine Label')).toBeInTheDocument()
  })
})

describe('LabelScanFlow — Continue hands off to review (WI-6)', () => {
  it('calls onReview with autoFireReviews true for a freshly created draft', async () => {
    mockScanLabel.mockResolvedValue(makeScan())
    mockCreateWine.mockResolvedValue(makeWine())
    const onReview = vi.fn()

    render(<LabelScanFlow wines={[]} onReview={onReview} onDone={() => {}} />)
    await uploadAFile()
    await waitFor(() => expect(mockCreateWine).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(onReview).toHaveBeenCalledWith(makeWine(), true))
  })

  it('does not re-fire enrichment on Continue when nothing was edited', async () => {
    mockScanLabel.mockResolvedValue(makeScan())
    mockCreateWine.mockResolvedValue(makeWine())

    render(<LabelScanFlow wines={[]} onReview={() => {}} onDone={() => {}} />)
    await uploadAFile()
    await waitFor(() => expect(mockFetchReviews).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Give any errant async re-fire a tick to happen, then assert it didn't.
    await new Promise((r) => setTimeout(r, 0))
    expect(mockFetchReviews).toHaveBeenCalledTimes(1)
    expect(mockFetchPrice).toHaveBeenCalledTimes(1)
  })
})
