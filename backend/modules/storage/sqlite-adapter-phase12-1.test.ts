/**
 * Phase 12.1 storage behaviour: notes outlive their wine (migration 008),
 * the manual price column (migration 009), and the derived read-path fields.
 */
import Database from 'better-sqlite3'
import { SQLiteAdapter } from './sqlite-adapter'
import type { CreateTastingNoteInput, CreateWineInput } from '@shared/types'
import { review, score } from '../../tests/helpers/review-fixtures'

function makeAdapter(): { adapter: SQLiteAdapter; db: Database.Database } {
  const db = new Database(':memory:')
  return { adapter: new SQLiteAdapter(db), db }
}

const WINE: CreateWineInput = {
  producer: 'Georges Roumier', vintage: 2018, region: 'Burgundy',
  denomination: 'Chambolle-Musigny', grape_varieties: null, label_image_url: null,
  tag_discovered: false, tag_wishlist: false, tag_cellar: true, tag_consumed: false,
  cellar_quantity: 3, cellar_category: null, drinking_window: null,
  vintage_rating: null, my_rating: null, my_tags: [], wishlist_notes: null,
  price_paid: null, purchased_from: null, date_first_consumed: null,
  quality_classification: null, vineyard: 'Les Amoureuses', cuvee: null, wine_color: 'red',
}

const NOTE = (wine_id: string): CreateTastingNoteInput => ({
  wine_id, tasted_at: '2026-10-01T20:00:00.000Z',
  clarity: 'clear', colour_intensity: null, colour: null,
  nose_condition: null, nose_intensity: null,
  nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
  palate_sweetness: null, palate_acidity: null, palate_tannin: null,
  palate_body: null, palate_flavour_intensity: null, palate_finish: null,
  quality_assessment: null, my_rating: 'good', free_text: 'Lovely.', tags: [],
})

describe('tasting notes outlive the wine (Phase 12.1 WI-3)', () => {
  it('copies the wine identity onto the note at save time', async () => {
    const { adapter } = makeAdapter()
    const wine = await adapter.createWine(WINE)
    const note = await adapter.createTastingNote(NOTE(wine.id))
    expect(note).toMatchObject({
      wine_id: wine.id,
      wine_producer: 'Georges Roumier',
      wine_denomination: 'Chambolle-Musigny',
      wine_vintage: 2018,
      wine_vineyard: 'Les Amoureuses',
      wine_cuvee: null,
      wine_removed: false,
    })
  })

  it('deleting a wine that has notes keeps the notes, detached, with their snapshot', async () => {
    const { adapter } = makeAdapter()
    const wine = await adapter.createWine(WINE)
    const a = await adapter.createTastingNote(NOTE(wine.id))
    const b = await adapter.createTastingNote({ ...NOTE(wine.id), tasted_at: '2026-10-02T20:00:00.000Z' })

    await adapter.deleteWine(wine.id)

    expect(await adapter.getWine(wine.id)).toBeNull()
    const kept = await adapter.getTastingNote(a.id)
    expect(kept).toMatchObject({
      id: a.id, wine_id: null, wine_removed: true,
      wine_producer: 'Georges Roumier', wine_denomination: 'Chambolle-Musigny', wine_vintage: 2018,
      free_text: 'Lovely.',
    })
    const all = await adapter.listTastingNotes()
    expect(all.map((n) => n.id)).toEqual([b.id, a.id]) // newest first
    expect(await adapter.listTastingNotesByWine(wine.id)).toEqual([])
  })

  it('a note edited into a re-added wine starts a fresh history — the old note stays detached', async () => {
    const { adapter } = makeAdapter()
    const wine = await adapter.createWine(WINE)
    const old = await adapter.createTastingNote(NOTE(wine.id))
    await adapter.deleteWine(wine.id)

    const again = await adapter.createWine(WINE)
    expect(await adapter.listTastingNotesByWine(again.id)).toEqual([])
    expect((await adapter.getTastingNote(old.id))!.wine_removed).toBe(true)
  })

  it('enforces foreign keys, so ON DELETE SET NULL actually fires', async () => {
    const { db } = makeAdapter()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('does not block deleting a wine that advice points at', async () => {
    const { adapter } = makeAdapter()
    const wine = await adapter.createWine(WINE)
    await adapter.createAdvice({
      wine_id: wine.id, source_name: 'A friend', source_role: 'friend', category: 'producer',
      content: 'Buy more.', captured_at: '2026-10-01T00:00:00.000Z',
    })
    await expect(adapter.deleteWine(wine.id)).resolves.toBeUndefined()
    const advice = await adapter.listAdvice()
    expect(advice).toHaveLength(1)
    expect(advice[0].wine_id).toBeNull()
  })
})

describe('manual_price (Phase 12.1 D12, migration 009)', () => {
  it('is null on creation, round-trips through updateWine, and clears with null', async () => {
    const { adapter } = makeAdapter()
    const wine = await adapter.createWine(WINE)
    expect(wine.manual_price).toBeNull()

    const set = await adapter.updateWine(wine.id, { manual_price: 87.5 })
    expect(set.manual_price).toBe(87.5)
    expect((await adapter.getWine(wine.id))!.manual_price).toBe(87.5)

    const cleared = await adapter.updateWine(wine.id, { manual_price: null })
    expect(cleared.manual_price).toBeNull()
  })

  it('survives an automated price_data rewrite', async () => {
    const { adapter } = makeAdapter()
    const wine = await adapter.createWine(WINE)
    await adapter.updateWine(wine.id, { manual_price: 50 })
    const rewritten = await adapter.updateWine(wine.id, {
      price_data: {
        price_min: 10, price_avg: 20, price_max: 30, other_vintage_price_range: null,
        retailers: [], nearest_retailer: null, fetched_at: '2026-10-01T00:00:00.000Z',
      },
    })
    expect(rewritten.manual_price).toBe(50)
    expect(rewritten.price_data!.price_avg).toBe(20)
  })
})

describe('derived read-path fields (Phase 12.1)', () => {
  it('carries window_status, critic_summary and enrichment_stale on every read', async () => {
    const { adapter } = makeAdapter()
    const wine = await adapter.createWine({ ...WINE, tag_cellar: true })
    await adapter.updateWine(wine.id, {
      promoted_at: '2026-10-01T00:00:00.000Z',
      review_data: [
        review('a', 2018, [score('Vinous', 93, { window: [2025, 2035] })]),
        review('b', 2018, [score('Burghound', 91, { window: [2030, 2045] })]),
      ],
    })
    const read = (await adapter.getWine(wine.id))!
    expect(read.window_status).toBe('check')
    expect(read.critic_summary!.ordered.map((i) => i.publication)).toEqual(['Vinous', 'Burghound'])
    expect(read.enrichment_stale).toEqual({ price: false, reviews: false })

    const listed = (await adapter.listWines())[0]
    expect(listed.window_status).toBe('check')
  })

  it('a manual window makes it primary and the critic windows stay for reference', async () => {
    const { adapter } = makeAdapter()
    const wine = await adapter.createWine({ ...WINE, drinking_window: { start: '2030-01-01', end: '2040-01-01' } })
    expect((await adapter.getWine(wine.id))!.window_status).toBe('primary')
  })

  it('wines with nothing to say get none and an empty summary', async () => {
    const { adapter } = makeAdapter()
    const wine = await adapter.createWine(WINE)
    const read = (await adapter.getWine(wine.id))!
    expect(read.window_status).toBe('none')
    expect(read.critic_summary).toEqual({ ordered: [] })
  })
})
