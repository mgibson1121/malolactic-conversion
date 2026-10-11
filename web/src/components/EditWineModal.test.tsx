import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { EditWineModal } from './EditWineModal'
import { makeTestPriceData, makeTestRetailer, makeTestWine } from '../test-fixtures'
import { countNotesKeptOnDelete, deleteWine, fetchWinePrice, fetchWineReviews, updateWine } from '../api'

vi.mock('../api', () => ({
  updateWine: vi.fn(),
  deleteWine: vi.fn(),
  countNotesKeptOnDelete: vi.fn(),
  fetchWinePrice: vi.fn(),
  fetchWineReviews: vi.fn(),
}))

const mUpdate = updateWine as unknown as ReturnType<typeof vi.fn>
const mDelete = deleteWine as unknown as ReturnType<typeof vi.fn>
const mCount = countNotesKeptOnDelete as unknown as ReturnType<typeof vi.fn>
const mPrice = fetchWinePrice as unknown as ReturnType<typeof vi.fn>
const mReviews = fetchWineReviews as unknown as ReturnType<typeof vi.fn>

const withData = () =>
  makeTestWine({ price_data: makeTestPriceData([makeTestRetailer()]), review_data: [] })

function setup(wine = withData()) {
  const onSaved = vi.fn()
  const onDeleted = vi.fn()
  const onClose = vi.fn()
  render(<EditWineModal wine={wine} onSaved={onSaved} onDeleted={onDeleted} onClose={onClose} />)
  return { onSaved, onDeleted, onClose, wine }
}

const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }))

beforeEach(() => {
  mUpdate.mockImplementation(async (id: string, patch: object) => ({ ...withData(), id, ...patch }))
  mPrice.mockImplementation(async (id: string) => ({ ...withData(), id }))
  mReviews.mockImplementation(async (id: string) => ({ ...withData(), id }))
  mDelete.mockResolvedValue(undefined)
  mCount.mockResolvedValue(0)
})
afterEach(() => vi.clearAllMocks())

describe('EditWineModal — refresh prompt (Phase 12.1 D4)', () => {
  it('changing the producer on a wine with data asks "Refresh searches now?" and states the cost', async () => {
    setup()
    await userEvent.clear(screen.getByLabelText('Producer'))
    await userEvent.type(screen.getByLabelText('Producer'), 'Domaine Leroy Estate')
    await save()

    const prompt = await screen.findByRole('alertdialog', { name: 'Refresh searches now?' })
    expect(prompt).toHaveTextContent('about 10 credits (up to 25)')
    // Nothing has been saved or spent yet.
    expect(mUpdate).not.toHaveBeenCalled()
    expect(mPrice).not.toHaveBeenCalled()
  })

  it('Yes: saves, then hard-refreshes price and reviews once each', async () => {
    const { onSaved } = setup()
    await userEvent.type(screen.getByLabelText('Cuvée'), 'Les Cazetiers')
    await save()
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh now' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mUpdate).toHaveBeenCalledWith('wine-1', { cuvee: 'Les Cazetiers' })
    expect(mPrice).toHaveBeenCalledTimes(1)
    expect(mPrice).toHaveBeenCalledWith('wine-1', { force: true })
    expect(mReviews).toHaveBeenCalledTimes(1)
    expect(mReviews).toHaveBeenCalledWith('wine-1', { force: true })
  })

  it('No: saves and keeps the old data — nothing is spent', async () => {
    const { onSaved } = setup()
    await userEvent.type(screen.getByLabelText('Cuvée'), 'Les Cazetiers')
    await save()
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mUpdate).toHaveBeenCalledTimes(1)
    expect(mPrice).not.toHaveBeenCalled()
    expect(mReviews).not.toHaveBeenCalled()
  })

  it.each([
    ['quantity', () => userEvent.type(screen.getByLabelText('Bottles in the cellar'), '0')],
    ['colour', () => userEvent.selectOptions(screen.getByLabelText('Colour'), 'white')],
    ['your price', () => userEvent.type(screen.getByLabelText(/Your price/), '90')],
    ['a list tag', () => userEvent.click(screen.getByRole('button', { name: /Wishlist/ }))],
  ])('changing %s never prompts', async (_name, change) => {
    const { onSaved } = setup()
    await change()
    await save()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mPrice).not.toHaveBeenCalled()
    expect(mReviews).not.toHaveBeenCalled()
  })

  it('an identity change on a wine with no stored data does not prompt', async () => {
    const { onSaved } = setup(makeTestWine())
    await userEvent.type(screen.getByLabelText('Cuvée'), 'X')
    await save()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('a casing-only change is not an identity change', async () => {
    const { onSaved } = setup()
    await userEvent.clear(screen.getByLabelText('Producer'))
    await userEvent.type(screen.getByLabelText('Producer'), 'DOMAINE LEROY')
    await save()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('EditWineModal — Your price (D12)', () => {
  it('sends a valid manual price', async () => {
    setup()
    await userEvent.type(screen.getByLabelText(/Your price/), '87.50')
    await save()
    await waitFor(() => expect(mUpdate).toHaveBeenCalledWith('wine-1', { manual_price: 87.5 }))
  })

  it('clearing it sends null', async () => {
    setup(makeTestWine({ manual_price: 60 }))
    await userEvent.clear(screen.getByLabelText(/Your price/))
    await save()
    await waitFor(() => expect(mUpdate).toHaveBeenCalledWith('wine-1', { manual_price: null }))
  })

  it.each(['0', '-5', '12.345', 'abc'])('rejects %s without calling the server', async (bad) => {
    setup()
    await userEvent.type(screen.getByLabelText(/Your price/), bad)
    await save()
    expect(await screen.findByText(/positive amount with at most two decimals/)).toBeInTheDocument()
    expect(mUpdate).not.toHaveBeenCalled()
  })
})

describe('EditWineModal — drinking window (D2)', () => {
  it('setting a window sends a manual window', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Window start year'), '2028')
    await userEvent.type(screen.getByLabelText('Window end year'), '2040')
    await save()
    await waitFor(() =>
      expect(mUpdate).toHaveBeenCalledWith('wine-1', { drinking_window: { start: '2028-01-01', end: '2040-12-31' } })
    )
  })

  it('a pre-filled "from critics" window left alone is not saved as a manual one', async () => {
    const { onSaved } = setup(
      makeTestWine({ drinking_window: { start: '2028-01-01', end: '2040-01-01' }, drinking_window_source: 'derived' })
    )
    expect(screen.getByLabelText('Window start year')).toHaveValue('2028')
    expect(screen.getByText('From critics. Change it to make it yours.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Bottles in the cellar'), '0')
    await save()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mUpdate.mock.calls[0][1]).not.toHaveProperty('drinking_window')
  })

  it('clearing both years sends null, handing the wine back to the critics', async () => {
    setup(makeTestWine({ drinking_window: { start: '2028-01-01', end: '2040-12-31' }, drinking_window_source: 'manual' }))
    await userEvent.clear(screen.getByLabelText('Window start year'))
    await userEvent.clear(screen.getByLabelText('Window end year'))
    await save()
    await waitFor(() => expect(mUpdate).toHaveBeenCalledWith('wine-1', { drinking_window: null }))
  })

  it('rejects a half-filled or backwards window', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Window start year'), '2040')
    await userEvent.type(screen.getByLabelText('Window end year'), '2030')
    await save()
    expect(await screen.findByText(/start no later than end/)).toBeInTheDocument()
    expect(mUpdate).not.toHaveBeenCalled()
  })

  it('tells you to enter one when the critics disagree', () => {
    setup(
      makeTestWine({ window_status: 'check', drinking_window: null })
    )
    expect(screen.getByText(/critics disagree on this wine’s window/)).toBeInTheDocument()
  })
})

describe('EditWineModal — delete (WI-3, D5)', () => {
  it('names the notes that will stay', async () => {
    mCount.mockResolvedValue(2)
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete wine' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this wine?' })
    expect(dialog).toHaveTextContent('Its 2 tasting notes stay in Notes, marked “wine removed”.')
  })

  it('uses the short confirmation when there are no notes', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete wine' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this wine?' })
    expect(dialog).not.toHaveTextContent('tasting note')
  })

  it('does not delete until confirmed, and then reports it', async () => {
    const { onDeleted } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete wine' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this wine?' })
    expect(mDelete).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete wine' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('wine-1'))
    expect(mDelete).toHaveBeenCalledWith('wine-1')
  })

  it('"Keep it" backs out', async () => {
    const { onDeleted } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete wine' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Keep it' }))
    expect(mDelete).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
