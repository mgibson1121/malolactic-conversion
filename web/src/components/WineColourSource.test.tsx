/** Phase 12.4 WI-6: an imported wine's inferred colour carries the Sourced marker on detail. */
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { WineDetailModal } from './WineDetailModal'
import { makeTestWine } from '../test-fixtures'
import { resetPriceOnce } from '../utils/priceOnce'

vi.mock('../api', () => ({
  fetchWinePrice: vi.fn(),
  fetchWineReviews: vi.fn(),
  resolveRetailerUrl: vi.fn(),
  listTastingNotesByWine: vi.fn().mockResolvedValue([]),
  fetchRetailerLinks: vi.fn().mockResolvedValue([]),
  confirmRetailerLink: vi.fn(),
  updateWine: vi.fn(),
}))

const noop = () => {}
const detail = (wine: ReturnType<typeof makeTestWine>) =>
  render(<WineDetailModal wine={wine} onClose={noop} onTagUpdate={noop} onQuantityChange={noop} onEvaluate={noop} onWineUpdated={noop} onEdit={noop} />)

beforeEach(() => resetPriceOnce())

describe('Colour provenance on detail', () => {
  it('marks an inferred colour Sourced', () => {
    detail(makeTestWine({ wine_color: 'white', wine_color_source: 'derived', price_data: null }))
    expect(screen.getByTitle(/Colour inferred from the appellation/)).toHaveTextContent('Sourced')
  })

  it('a scanned, typed or edited colour carries no marker', () => {
    detail(makeTestWine({ wine_color: 'red', wine_color_source: 'manual', price_data: null }))
    expect(screen.queryByTitle(/Colour inferred/)).not.toBeInTheDocument()
  })
})
