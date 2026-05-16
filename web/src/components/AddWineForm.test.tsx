import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddWineForm } from './AddWineForm'

describe('AddWineForm', () => {
  it('renders all key fields', () => {
    render(<AddWineForm defaultStatus="cellar" onSubmit={async () => {}} onCancel={() => {}} />)
    expect(screen.getByLabelText('Name *')).toBeInTheDocument()
    expect(screen.getByLabelText('Producer')).toBeInTheDocument()
    expect(screen.getByLabelText('Vintage')).toBeInTheDocument()
    expect(screen.getByLabelText('Region')).toBeInTheDocument()
    expect(screen.getByLabelText('Denomination')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByLabelText('Cellar Category')).toBeInTheDocument()
  })

  it('save button is disabled when name is empty', () => {
    render(<AddWineForm defaultStatus="cellar" onSubmit={async () => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: 'Save Wine' })).toBeDisabled()
  })

  it('save button enables once name is typed', async () => {
    render(<AddWineForm defaultStatus="cellar" onSubmit={async () => {}} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('Name *'), 'Gevrey-Chambertin')
    expect(screen.getByRole('button', { name: 'Save Wine' })).toBeEnabled()
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn()
    render(<AddWineForm defaultStatus="cellar" onSubmit={async () => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('defaults status select to defaultStatus prop', () => {
    render(<AddWineForm defaultStatus="wishlist" onSubmit={async () => {}} onCancel={() => {}} />)
    const select = screen.getByLabelText('Status') as HTMLSelectElement
    expect(select.value).toBe('wishlist')
  })

  it('submits with correct data including optional fields', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AddWineForm defaultStatus="cellar" onSubmit={onSubmit} onCancel={() => {}} />)

    await userEvent.type(screen.getByLabelText('Name *'), 'Gevrey-Chambertin')
    await userEvent.type(screen.getByLabelText('Producer'), 'Rossignol-Trapet')
    await userEvent.type(screen.getByLabelText('Vintage'), '2018')
    await userEvent.type(screen.getByLabelText('Region'), 'Burgundy')
    await userEvent.type(screen.getByLabelText('Grape Varieties (comma-separated)'), 'Pinot Noir')

    await userEvent.click(screen.getByRole('button', { name: 'Save Wine' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Gevrey-Chambertin',
          producer: 'Rossignol-Trapet',
          vintage: 2018,
          region: 'Burgundy',
          grape_varieties: ['Pinot Noir'],
          status: 'cellar',
        })
      )
    })
  })

  it('submits with name only (all other fields null/empty)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AddWineForm defaultStatus="discovered" onSubmit={onSubmit} onCancel={() => {}} />)

    await userEvent.type(screen.getByLabelText('Name *'), 'Mystery Wine')
    await userEvent.click(screen.getByRole('button', { name: 'Save Wine' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Mystery Wine',
          producer: null,
          vintage: null,
          status: 'discovered',
        })
      )
    })
  })

  it('shows error message when onSubmit throws', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network error'))
    render(<AddWineForm defaultStatus="cellar" onSubmit={onSubmit} onCancel={() => {}} />)

    await userEvent.type(screen.getByLabelText('Name *'), 'Test Wine')
    await userEvent.click(screen.getByRole('button', { name: 'Save Wine' }))

    await waitFor(() => {
      expect(screen.getByText(/Failed to save/)).toBeInTheDocument()
    })
  })
})
