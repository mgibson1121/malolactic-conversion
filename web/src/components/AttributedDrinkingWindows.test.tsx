import { render, screen } from '@testing-library/react'
import { AttributedDrinkingWindows } from './AttributedDrinkingWindows'

describe('AttributedDrinkingWindows', () => {
  it('renders nothing when there are no windows', () => {
    const { container } = render(<AttributedDrinkingWindows windows={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the critic alongside each window', () => {
    render(
      <AttributedDrinkingWindows
        windows={[
          { start: 2029, end: 2045, publications: ['Decanter'] },
          { start: 2026, end: 2038, publications: ['Vinous'] },
        ]}
      />
    )

    expect(screen.getByText('2029–2045')).toBeInTheDocument()
    expect(screen.getByText('Decanter')).toBeInTheDocument()
    expect(screen.getByText('2026–2038')).toBeInTheDocument()
    expect(screen.getByText('Vinous')).toBeInTheDocument()
  })

  // The count is of critics, not windows — three critics across two windows
  // must not report "2 critics".
  it('counts critics rather than distinct windows in the disagreement note', () => {
    render(
      <AttributedDrinkingWindows
        windows={[
          { start: 2029, end: 2045, publications: ['Decanter', 'Wine Advocate'] },
          { start: 2026, end: 2038, publications: ['Vinous'] },
        ]}
      />
    )

    expect(screen.getByText('3 critics, 2 different windows')).toBeInTheDocument()
  })

  it('omits the disagreement note when only one window is present', () => {
    render(
      <AttributedDrinkingWindows
        windows={[{ start: 2029, end: 2045, publications: ['Decanter'] }]}
      />
    )

    expect(screen.queryByText(/different windows/)).not.toBeInTheDocument()
    expect(screen.getByText('2029–2045')).toBeInTheDocument()
  })

  // No averaging, no outer bounds, no "most critics say" (CLAUDE.md §15).
  it('never renders a reconciled range across disagreeing critics', () => {
    render(
      <AttributedDrinkingWindows
        windows={[
          { start: 2029, end: 2045, publications: ['Decanter'] },
          { start: 2026, end: 2038, publications: ['Vinous'] },
        ]}
      />
    )

    expect(screen.queryByText('2026–2045')).not.toBeInTheDocument()
    expect(screen.queryByText('2027–2041')).not.toBeInTheDocument()
  })
})
