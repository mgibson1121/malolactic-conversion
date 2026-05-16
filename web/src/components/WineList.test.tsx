import { render, screen } from '@testing-library/react'
import { WineList } from './WineList'
import type { WineEntry } from '@shared/types'

function makeWine(overrides: Partial<WineEntry> = {}): WineEntry {
  return {
    id: 'wine-1',
    name: 'Chambolle-Musigny',
    producer: 'Roumier',
    vintage: 2019,
    region: 'Burgundy',
    denomination: 'Chambolle-Musigny',
    grape_varieties: ['Pinot Noir'],
    quality_classification: null,
    vineyard: null,
    label_image_url: null,
    status: 'cellar',
    cellar_category: null,
    drinking_window: null,
    vintage_rating: null,
    my_rating: null,
    my_tags: [],
    wishlist_notes: null,
    price_paid: null,
    purchased_from: null,
    tasting_note_id: null,
    advice_linked: null,
    expert_reviews: null,
    community_sentiment: null,
    community_excerpts: null,
    price_data: null,
    date_added: '2024-01-01T00:00:00.000Z',
    date_consumed: null,
    ...overrides,
  }
}

describe('WineList', () => {
  it('renders empty state when no wines', () => {
    render(<WineList wines={[]} onPromote={() => {}} />)
    expect(screen.getByText('No wines here yet.')).toBeInTheDocument()
  })

  it('renders wine name and producer', () => {
    render(<WineList wines={[makeWine()]} onPromote={() => {}} />)
    // name appears in wine-name div; denomination also shows "Chambolle-Musigny" in meta
    expect(screen.getAllByText('Chambolle-Musigny').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Roumier')).toBeInTheDocument()
  })

  it('renders vintage and region', () => {
    render(<WineList wines={[makeWine()]} onPromote={() => {}} />)
    expect(screen.getByText('2019')).toBeInTheDocument()
    expect(screen.getByText('Burgundy')).toBeInTheDocument()
  })

  it('renders multiple wines', () => {
    const wines = [
      makeWine({ id: '1', name: 'Wine A' }),
      makeWine({ id: '2', name: 'Wine B' }),
    ]
    render(<WineList wines={wines} onPromote={() => {}} />)
    expect(screen.getByText('Wine A')).toBeInTheDocument()
    expect(screen.getByText('Wine B')).toBeInTheDocument()
  })

  it('shows promote button for cellar wines', () => {
    render(<WineList wines={[makeWine({ status: 'cellar' })]} onPromote={() => {}} />)
    expect(screen.getByRole('button', { name: /Move to Consumed/ })).toBeInTheDocument()
  })

  it('shows correct next status for wishlist wines', () => {
    render(<WineList wines={[makeWine({ status: 'wishlist' })]} onPromote={() => {}} />)
    expect(screen.getByRole('button', { name: /Move to Cellar/ })).toBeInTheDocument()
  })

  it('shows correct next status for discovered wines', () => {
    render(<WineList wines={[makeWine({ status: 'discovered' })]} onPromote={() => {}} />)
    expect(screen.getByRole('button', { name: /Move to Wishlist/ })).toBeInTheDocument()
  })

  it('hides promote button for consumed wines', () => {
    render(<WineList wines={[makeWine({ status: 'consumed' })]} onPromote={() => {}} />)
    expect(screen.queryByRole('button', { name: /Move to/ })).not.toBeInTheDocument()
  })

  it('calls onPromote with correct id and next status', () => {
    const onPromote = vi.fn()
    render(<WineList wines={[makeWine({ id: 'abc', status: 'wishlist' })]} onPromote={onPromote} />)
    screen.getByRole('button', { name: /Move to Cellar/ }).click()
    expect(onPromote).toHaveBeenCalledWith('abc', 'cellar')
  })
})
