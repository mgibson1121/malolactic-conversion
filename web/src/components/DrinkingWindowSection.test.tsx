import { render, screen } from '@testing-library/react'
import type { WineEntry } from '@shared/types'
import { DrinkingWindowSection } from './DrinkingWindowSection'
import { makeTestWine } from '../test-fixtures'

const DISAGREE = [
  {
    slug: 'a', name: 'A', product_url: 'https://a', fetched_at: '2026-10-01T00:00:00.000Z', source: 'configured',
    page_vintage: 2019, vintage_gap: 0, page_price: null,
    match: { producer: 'match', denomination: 'match', bottling: 'unknown', vintage: 'match', candidateVintage: 2019, vintageGap: 0 },
    critic_scores: [
      { publication: 'Vinous', score: 93, known_publication: true, drinking_window: { start: 2025, end: 2035 }, vintage_character: null, deal: false },
      { publication: 'Burghound', score: 91, known_publication: true, drinking_window: { start: 2030, end: 2045 }, vintage_character: null, deal: false },
    ],
  },
] as unknown as WineEntry['review_data']

describe('DrinkingWindowSection (Phase 12.1 WI-2, D2)', () => {
  it('"Your window" for a manual window, with critic windows below as reference only', () => {
    render(
      <DrinkingWindowSection
        wine={makeTestWine({
          drinking_window: { start: '2030-01-01', end: '2040-12-31' },
          drinking_window_source: 'manual',
          review_data: DISAGREE,
        })}
      />
    )
    expect(screen.getByText('Your window')).toBeInTheDocument()
    expect(screen.getByText('Critic windows (for reference)')).toBeInTheDocument()
    expect(screen.getByText('reference only')).toBeInTheDocument()
    // A manual window never hides what the critics said.
    expect(screen.getByText('2025–2035')).toBeInTheDocument()
    expect(screen.getByText('2030–2045')).toBeInTheDocument()
  })

  it('"Window (from critics)" with the Sourced marker when derived', () => {
    render(
      <DrinkingWindowSection
        wine={makeTestWine({ drinking_window: { start: '2028-01-01', end: '2040-01-01' }, drinking_window_source: 'derived' })}
      />
    )
    expect(screen.getByText('Window (from critics)')).toBeInTheDocument()
    expect(screen.getByText('Sourced')).toBeInTheDocument()
    expect(screen.queryByText('Your window')).not.toBeInTheDocument()
  })

  it('a Check-window wine shows no primary window, the critic rows, and a nudge to set one', () => {
    render(<DrinkingWindowSection wine={makeTestWine({ drinking_window: null, review_data: DISAGREE })} />)
    expect(screen.queryByText('Your window')).not.toBeInTheDocument()
    expect(screen.queryByText('Window (from critics)')).not.toBeInTheDocument()
    expect(screen.getByText(/The critics disagree\. Set your own window in Edit\./)).toBeInTheDocument()
    expect(screen.getByText('Critic windows (for reference)')).toBeInTheDocument()
  })

  it('renders nothing at all when there is no window of any kind', () => {
    const { container } = render(<DrinkingWindowSection wine={makeTestWine()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
