import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TastingNote } from '@shared/types'
import { RemovedWineNotes } from './RemovedWineNotes'

const note = (over: Partial<TastingNote> = {}): TastingNote => ({
  id: 'n1', wine_id: null, wine_producer: 'Georges Roumier', wine_denomination: 'Chambolle-Musigny', wine_vintage: 2018,
  wine_vineyard: null, wine_cuvee: null, wine_removed: true, tasted_at: '2026-10-01T20:00:00.000Z',
  clarity: null, colour_intensity: null, colour: null, nose_condition: null, nose_intensity: null,
  nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
  palate_sweetness: null, palate_acidity: null, palate_tannin: null, palate_body: null,
  palate_flavour_intensity: null, palate_finish: null, quality_assessment: null,
  my_rating: 'good', free_text: 'Silky and long.', tags: [], ...over,
})

describe('RemovedWineNotes (Phase 12.1 WI-3, D5)', () => {
  it('lists a detached note under its original identity with a "Wine removed" tag', () => {
    render(<RemovedWineNotes notes={[note()]} />)
    expect(screen.getByText('Georges Roumier · Chambolle-Musigny · 2018')).toBeInTheDocument()
    expect(screen.getByText('Wine removed')).toBeInTheDocument()
  })

  it('opens read-only: the note text, and no Evaluate or price/review actions', async () => {
    render(<RemovedWineNotes notes={[note()]} />)
    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Silky and long.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Evaluate|Fetch|Refresh|Edit/ })).not.toBeInTheDocument()
  })

  it('renders nothing when no wine has been removed', () => {
    const { container } = render(<RemovedWineNotes notes={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
