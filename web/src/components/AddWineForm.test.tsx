import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WineEntry } from '@shared/types'
import { AddWineForm } from './AddWineForm'

const FAKE_WINE = { id: 'w1' } as unknown as WineEntry
const noopSubmit = async () => FAKE_WINE

describe('AddWineForm', () => {
  it('renders all key fields', () => {
    render(<AddWineForm onSubmit={noopSubmit} onCancel={() => {}} />)
    expect(screen.getByLabelText('Producer *')).toBeInTheDocument()
    expect(screen.getByLabelText('Denomination *')).toBeInTheDocument()
    expect(screen.getByLabelText('Vintage')).toBeInTheDocument()
    expect(screen.getByLabelText('Region')).toBeInTheDocument()
  })

  it('does not render a Status field', () => {
    render(<AddWineForm onSubmit={noopSubmit} onCancel={() => {}} />)
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
  })

  // Phase 9.3, WI-1: cellar_category is no longer collected at creation —
  // read nowhere downstream, so asking for it here was dead weight.
  it('does not render a Cellar Category field', () => {
    render(<AddWineForm onSubmit={noopSubmit} onCancel={() => {}} />)
    expect(screen.queryByLabelText('Cellar Category')).not.toBeInTheDocument()
  })

  it('save button is disabled when both producer and denomination are empty', () => {
    render(<AddWineForm onSubmit={noopSubmit} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: 'Save Wine' })).toBeDisabled()
  })

  it('save button enables once denomination is typed', async () => {
    render(<AddWineForm onSubmit={noopSubmit} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('Denomination *'), 'Gevrey-Chambertin')
    expect(screen.getByRole('button', { name: 'Save Wine' })).toBeEnabled()
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn()
    render(<AddWineForm onSubmit={noopSubmit} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('submits with correct data including optional fields', async () => {
    const onSubmit = vi.fn().mockResolvedValue(FAKE_WINE)
    render(<AddWineForm onSubmit={onSubmit} onCancel={() => {}} />)

    await userEvent.type(screen.getByLabelText('Producer *'), 'Rossignol-Trapet')
    await userEvent.type(screen.getByLabelText('Denomination *'), 'Gevrey-Chambertin')
    await userEvent.type(screen.getByLabelText('Vintage'), '2018')
    await userEvent.type(screen.getByLabelText('Region'), 'Burgundy')
    await userEvent.type(screen.getByLabelText(/Grape Varieties/), 'Pinot Noir')

    await userEvent.click(screen.getByRole('button', { name: 'Save Wine' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          producer: 'Rossignol-Trapet',
          denomination: 'Gevrey-Chambertin',
          vintage: 2018,
          region: 'Burgundy',
          grape_varieties: ['Pinot Noir'],
          tag_discovered: true,
          tag_wishlist: false,
          tag_cellar: false,
          tag_consumed: false,
          cellar_quantity: 0,
          cellar_category: null,
        })
      )
    })
  })

  it('submits with denomination only (all other fields null)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(FAKE_WINE)
    render(<AddWineForm onSubmit={onSubmit} onCancel={() => {}} />)

    await userEvent.type(screen.getByLabelText('Denomination *'), 'Muscadet')
    await userEvent.click(screen.getByRole('button', { name: 'Save Wine' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          denomination: 'Muscadet',
          producer: null,
          vintage: null,
          cellar_category: null,
          tag_discovered: true,
        })
      )
    })
  })

  it('shows error message when onSubmit throws', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network error'))
    render(<AddWineForm onSubmit={onSubmit} onCancel={() => {}} />)

    await userEvent.type(screen.getByLabelText('Denomination *'), 'Barolo')
    await userEvent.click(screen.getByRole('button', { name: 'Save Wine' }))

    await waitFor(() => {
      expect(screen.getByText(/Failed to save/)).toBeInTheDocument()
    })
  })
})
