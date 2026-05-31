import { render, screen } from '@testing-library/react'
import { WineList } from './WineList'
import type { WineEntry } from '@shared/types'

function makeWine(overrides: Partial<WineEntry> = {}): WineEntry {
  return {
    id: 'wine-1',
    producer: 'Roumier',
    vintage: 2019,
    region: 'Burgundy',
    denomination: 'Chambolle-Musigny',
    grape_varieties: ['Pinot Noir'],
    quality_classification: null,
    vineyard: null,
    cuvee: null,
    label_image_url: null,
    tag_discovered: true,
    tag_wishlist: false,
    tag_cellar: false,
    tag_consumed: false,
    cellar_quantity: 0,
    cellar_category: null,
    drinking_window: null,
    vintage_rating: null,
    my_rating: null,
    my_tags: [],
    wishlist_notes: null,
    price_paid: null,
    purchased_from: null,
    latest_tasting_note_id: null,
    advice_linked: null,
    expert_reviews: null,
    community_sentiment: null,
    community_excerpts: null,
    price_data: null,
    date_added: '2024-01-01T00:00:00.000Z',
    date_first_consumed: null,
    ...overrides,
  }
}

const noop = () => {}

describe('WineList', () => {
  it('renders empty state when no wines', () => {
    render(
      <WineList
        wines={[]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('No wines here yet.')).toBeInTheDocument()
  })

  it('renders producer and denomination', () => {
    render(
      <WineList
        wines={[makeWine()]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('Roumier · Chambolle-Musigny')).toBeInTheDocument()
  })

  it('renders vintage and region', () => {
    render(
      <WineList
        wines={[makeWine()]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('2019')).toBeInTheDocument()
    expect(screen.getByText('Burgundy')).toBeInTheDocument()
  })

  it('renders multiple wines', () => {
    const wines = [
      makeWine({ id: '1', denomination: 'Barolo', producer: 'Giacomo Conterno' }),
      makeWine({ id: '2', denomination: 'Chablis', producer: 'Raveneau' }),
    ]
    render(
      <WineList
        wines={wines}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('Giacomo Conterno · Barolo')).toBeInTheDocument()
    expect(screen.getByText('Raveneau · Chablis')).toBeInTheDocument()
  })

  it('shows Evaluate button for all wines regardless of tags', () => {
    render(
      <WineList
        wines={[makeWine({ tag_discovered: true, tag_cellar: false })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByRole('button', { name: /Evaluate/ })).toBeInTheDocument()
  })

  it('shows Evaluate button for cellar wines', () => {
    render(
      <WineList
        wines={[makeWine({ tag_cellar: true })]}
        activeTab="cellar"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByRole('button', { name: /Evaluate/ })).toBeInTheDocument()
  })

  it('shows Evaluate button for wishlist wines', () => {
    render(
      <WineList
        wines={[makeWine({ tag_wishlist: true })]}
        activeTab="wishlist"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByRole('button', { name: /Evaluate/ })).toBeInTheDocument()
  })

  it('shows quantity controls on cellar tab when wine has tag_cellar', () => {
    render(
      <WineList
        wines={[makeWine({ tag_cellar: true, cellar_quantity: 3 })]}
        activeTab="cellar"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('3 btl')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add one bottle/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove one bottle/ })).toBeInTheDocument()
  })

  it('does not show quantity controls on non-cellar tabs', () => {
    render(
      <WineList
        wines={[makeWine({ tag_cellar: true, cellar_quantity: 3 })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.queryByText('3 btl')).not.toBeInTheDocument()
  })

  it('shows Reviews button when latest_tasting_note_id is set', () => {
    render(
      <WineList
        wines={[makeWine({ latest_tasting_note_id: 'note-uuid-123' })]}
        activeTab="tasting_notes"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByRole('button', { name: /Reviews/ })).toBeInTheDocument()
  })

  it('hides Reviews button when no tasting note exists', () => {
    render(
      <WineList
        wines={[makeWine({ latest_tasting_note_id: null })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.queryByRole('button', { name: /Reviews/ })).not.toBeInTheDocument()
  })

  it('shows rating badge when my_rating is set', () => {
    render(
      <WineList
        wines={[makeWine({ my_rating: 'outstanding' })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('Outstanding')).toBeInTheDocument()
  })

  it('shows active tag badges', () => {
    render(
      <WineList
        wines={[makeWine({ tag_discovered: true, tag_cellar: true })]}
        activeTab="cellar"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('Discovered')).toBeInTheDocument()
    expect(screen.getByText('Cellar')).toBeInTheDocument()
  })

  it('calls onEvaluate when Evaluate button is clicked', () => {
    const onEvaluate = vi.fn()
    const wine = makeWine({ id: 'abc' })
    render(
      <WineList
        wines={[wine]}
        activeTab="discovered"
        onEvaluate={onEvaluate}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    screen.getByRole('button', { name: /Evaluate/ }).click()
    expect(onEvaluate).toHaveBeenCalledWith(wine)
  })
})
