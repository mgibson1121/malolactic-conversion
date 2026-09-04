import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { WineEntry } from '@shared/types'
import { CellarStats } from './CellarStats'

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
    wine_color: null,
    label_image_url: null,
    tag_discovered: true,
    tag_wishlist: false,
    tag_cellar: true,
    tag_consumed: false,
    cellar_quantity: 1,
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
    promoted_at: '2024-01-01T00:00:00.000Z',
    date_first_consumed: null,
    ...overrides,
  }
}

describe('CellarStats', () => {
  it('renders nothing when the cellar is empty', () => {
    const { container } = render(
      <CellarStats wines={[]} settings={{ cellar_capacity: null }} onCapacityChange={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sums cellar_quantity across wines', () => {
    const { container } = render(
      <CellarStats
        wines={[makeWine({ cellar_quantity: 3 }), makeWine({ id: 'wine-2', cellar_quantity: 5 })]}
        settings={{ cellar_capacity: null }}
        onCapacityChange={vi.fn()}
      />
    )
    expect(container.querySelector('.cellar-stat-value')).toHaveTextContent('8')
    expect(screen.getByText('bottles in cellar')).toBeInTheDocument()
  })

  it('prompts to set capacity when unset', () => {
    render(
      <CellarStats wines={[makeWine()]} settings={{ cellar_capacity: null }} onCapacityChange={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'Set cellar capacity' })).toBeInTheDocument()
  })

  it('shows a computed percentage once capacity is set', () => {
    render(
      <CellarStats
        wines={[makeWine({ cellar_quantity: 30 })]}
        settings={{ cellar_capacity: 120 }}
        onCapacityChange={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Capacity used: 25%' })).toBeInTheDocument()
  })

  it('saves an edited capacity', async () => {
    const onCapacityChange = vi.fn().mockResolvedValue(undefined)
    render(
      <CellarStats wines={[makeWine()]} settings={{ cellar_capacity: null }} onCapacityChange={onCapacityChange} />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Set cellar capacity' }))
    await userEvent.type(screen.getByLabelText('Cellar capacity'), '240')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onCapacityChange).toHaveBeenCalledWith(240)
  })

  it('does not double-count wines outside the cellar in the region bars — grouped by region, split by wine_color', () => {
    render(
      <CellarStats
        wines={[
          makeWine({ id: 'w1', region: 'Burgundy', wine_color: 'red', cellar_quantity: 4 }),
          makeWine({ id: 'w2', region: 'Burgundy', wine_color: 'white', cellar_quantity: 2 }),
          makeWine({ id: 'w3', region: 'Loire', wine_color: null, cellar_quantity: 1 }),
        ]}
        settings={{ cellar_capacity: null }}
        onCapacityChange={vi.fn()}
      />
    )
    expect(screen.getByText('By region')).toBeInTheDocument()
    expect(screen.getByText('Burgundy')).toBeInTheDocument()
    expect(screen.getByText('Loire')).toBeInTheDocument()
    expect(screen.getByLabelText('Burgundy: 6 bottles')).toBeInTheDocument()
    expect(screen.getByLabelText('Loire: 1 bottles')).toBeInTheDocument()
  })
})
