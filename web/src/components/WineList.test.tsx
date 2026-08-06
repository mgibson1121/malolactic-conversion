import { render, screen } from '@testing-library/react'
import { WineList } from './WineList'
import type { WineEntry } from '@shared/types'
import { MATCHED_IDENTITY } from '../test-fixtures'

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
    drinking_window_source: null,
    vintage_rating: null,
    vintage_rating_source: null,
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
    expect(screen.getByRole('button', { name: /^Reviews$/ })).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: /^Reviews$/ })).not.toBeInTheDocument()
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

  it('shows the vintage rating badge, labeled "Year", when vintage_rating is set (2026-07-30 fix)', () => {
    // Was previously never rendered anywhere in the UI despite being
    // populated on some wines — reported as "not seeing ratings appear for
    // any of the wines in the discovered tag."
    render(
      <WineList
        wines={[makeWine({ vintage_rating: 'very_good' })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('Year: Very Good')).toBeInTheDocument()
  })

  it('does not show a vintage rating badge when vintage_rating is null', () => {
    render(
      <WineList
        wines={[makeWine({ vintage_rating: null })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.queryByText(/^Year:/)).not.toBeInTheDocument()
  })

  // ─── Critic scores in the list view (2026-07-30) ──────────────────────────
  // Previously only shown inside WineDetailModal, requiring a click-through
  // per wine — reported as "not seeing ratings appear ... I was referring to
  // numerical ratings ... put the number, source, and any other attributes
  // if available ... drinking window, vintage quality, or value."

  it('shows the number and source for a critic score citation in the list', () => {
    render(
      <WineList
        wines={[makeWine({
          review_data: [{
            slug: 'zachys',
            name: 'Zachys',
            product_url: 'https://www.zachys.com/x',
            source: 'configured',
            ...MATCHED_IDENTITY,
            critic_scores: [{
              publication: 'Wine Advocate',
              score: 94,
              known_publication: true,
              drinking_window: null,
              vintage_character: null,
              deal: false,
            }],
            fetched_at: '2026-07-30T00:00:00.000Z',
          }],
        })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('94')).toBeInTheDocument()
    expect(screen.getByText('Wine Advocate')).toBeInTheDocument()
  })

  it('shows drinking window, vintage character, and value coded attributes when the citation states them', () => {
    render(
      <WineList
        wines={[makeWine({
          review_data: [{
            slug: 'zachys',
            name: 'Zachys',
            product_url: 'https://www.zachys.com/x',
            source: 'configured',
            ...MATCHED_IDENTITY,
            critic_scores: [{
              publication: 'Vinous',
              score: 96,
              known_publication: true,
              drinking_window: { start: 2028, end: 2045 },
              vintage_character: 'very_good',
              deal: true,
            }],
            fetched_at: '2026-07-30T00:00:00.000Z',
          }],
        })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByText('Drink 2028–2045')).toBeInTheDocument()
    expect(screen.getByText('Very good vintage')).toBeInTheDocument()
    expect(screen.getByText('Value pick')).toBeInTheDocument()
  })

  it('omits coded-attribute badges the citation did not state', () => {
    render(
      <WineList
        wines={[makeWine({
          review_data: [{
            slug: 'zachys',
            name: 'Zachys',
            product_url: 'https://www.zachys.com/x',
            source: 'configured',
            ...MATCHED_IDENTITY,
            critic_scores: [{
              publication: 'Wine Advocate',
              score: 94,
              known_publication: true,
              drinking_window: null,
              vintage_character: null,
              deal: false,
            }],
            fetched_at: '2026-07-30T00:00:00.000Z',
          }],
        })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.queryByText('Value pick')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Drink /)).not.toBeInTheDocument()
  })

  it('shows a Fetch Reviews button when no review_data exists, Refresh Reviews once it does', () => {
    const { rerender } = render(
      <WineList
        wines={[makeWine({ review_data: null })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Fetch Reviews' })).toBeInTheDocument()

    rerender(
      <WineList
        wines={[makeWine({ review_data: [] })]}
        activeTab="discovered"
        onEvaluate={noop}
        onTagUpdate={noop}
        onQuantityChange={noop}
        onViewHistory={noop}
        onWineUpdated={noop}
        onViewDetail={noop}
      />
    )
    expect(screen.getByRole('button', { name: 'Refresh Reviews' })).toBeInTheDocument()
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
