/**
 * Unit tests for SQLiteAdapter using an in-memory database.
 * Tests mirror the SheetsAdapter unit test suite to verify both adapters
 * satisfy the same StorageAdapter contract.
 */
import Database from 'better-sqlite3'
import { SQLiteAdapter } from './sqlite-adapter'
import type { RetailerReview } from '@shared/types'

function makeAdapter(): SQLiteAdapter {
  const db = new Database(':memory:')
  return new SQLiteAdapter(db)
}

// ─── Wine CRUD ────────────────────────────────────────────────────────────────

describe('createWine', () => {
  it('assigns an id and date_added', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: null,
      vintage: 2018,
      region: 'Burgundy',
      denomination: 'Gevrey-Chambertin',
      grape_varieties: ['Pinot Noir'],
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
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })
    expect(wine.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(wine.date_added).toBeTruthy()
    expect(new Date(wine.date_added).getTime()).not.toBeNaN()
  })

  it('preserves all optional fields', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: "Domaine de la Pousse d'Or",
      vintage: 2019,
      region: 'Burgundy',
      denomination: 'Volnay',
      grape_varieties: ['Pinot Noir'],
      label_image_url: 'https://example.com/label.jpg',
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: true,
      tag_consumed: false,
      cellar_quantity: 6,
      cellar_category: 'long_term',
      drinking_window: { start: '2027-01-01', end: '2035-12-31' },
      vintage_rating: 'very_good',
      my_rating: 'outstanding',
      my_tags: ['silky', 'floral'],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })

    expect(wine.producer).toBe("Domaine de la Pousse d'Or")
    expect(wine.vintage).toBe(2019)
    expect(wine.region).toBe('Burgundy')
    expect(wine.denomination).toBe('Volnay')
    expect(wine.grape_varieties).toEqual(['Pinot Noir'])
    expect(wine.label_image_url).toBe('https://example.com/label.jpg')
    expect(wine.tag_cellar).toBe(true)
    expect(wine.cellar_quantity).toBe(6)
    expect(wine.cellar_category).toBe('long_term')
    expect(wine.drinking_window).toEqual({ start: '2027-01-01', end: '2035-12-31' })
    expect(wine.vintage_rating).toBe('very_good')
    expect(wine.my_rating).toBe('outstanding')
    expect(wine.my_tags).toEqual(['silky', 'floral'])
  })

  it('handles NV wines (null vintage)', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'Bollinger',
      vintage: null,
      region: 'Champagne',
      denomination: null,
      grape_varieties: ['Pinot Noir', 'Chardonnay', 'Pinot Meunier'],
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
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })
    expect(wine.vintage).toBeNull()
  })

  it('defaults tag_discovered to true and cellar_quantity to 0', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'Test',
      vintage: 2020,
      region: 'Burgundy',
      denomination: null,
      grape_varieties: null,
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
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })
    expect(wine.tag_discovered).toBe(true)
    expect(wine.cellar_quantity).toBe(0)
    expect(wine.latest_tasting_note_id).toBeNull()
  })
})

describe('getWine', () => {
  it('returns the wine after creation', async () => {
    const adapter = makeAdapter()
    const created = await adapter.createWine({
      producer: 'Giacomo Conterno',
      vintage: 2016,
      region: 'Piedmont',
      denomination: 'Barolo',
      grape_varieties: ['Nebbiolo'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: false,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: null,
      drinking_window: null,
      vintage_rating: 'very_good',
      my_rating: null,
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })

    const fetched = await adapter.getWine(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.denomination).toBe('Barolo')
    expect(fetched!.producer).toBe('Giacomo Conterno')
    expect(fetched!.vintage_rating).toBe('very_good')
  })

  it('returns null for unknown id', async () => {
    const adapter = makeAdapter()
    const result = await adapter.getWine('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })
})

describe('listWines', () => {
  // Phase 9.4 — createWine now always starts a wine as an unpromoted draft
  // (promoted_at NULL), invisible to listWines by default. These tests are
  // about the pre-existing tag/region/rating filters, not draft state, so
  // promote each wine immediately — draft exclusion itself is covered in
  // 'draft/promotion (Phase 9.4)' below.
  async function promote(adapter: SQLiteAdapter, id: string) {
    return adapter.updateWine(id, { promoted_at: new Date().toISOString() })
  }

  async function makeTwoWines(adapter: SQLiteAdapter) {
    const w1 = await adapter.createWine({
      producer: null, vintage: 2022, region: 'Loire', denomination: 'Muscadet',
      grape_varieties: ['Melon de Bourgogne'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: 'acceptable', my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })
    const w2 = await adapter.createWine({
      producer: 'Raveneau', vintage: 2020, region: 'Burgundy', denomination: 'Chablis',
      grape_varieties: ['Chardonnay'], label_image_url: null,
      tag_discovered: true, tag_wishlist: true, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: 'good',
      my_rating: null, my_tags: ['minerally'], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })
    await promote(adapter, w1.id)
    await promote(adapter, w2.id)
  }

  it('returns all wines without a filter', async () => {
    const adapter = makeAdapter()
    await makeTwoWines(adapter)
    const wines = await adapter.listWines()
    expect(wines).toHaveLength(2)
  })

  it('filters by tag_discovered', async () => {
    const adapter = makeAdapter()
    await makeTwoWines(adapter)
    const discovered = await adapter.listWines({ tag_discovered: true })
    expect(discovered).toHaveLength(2)
  })

  it('filters by tag_wishlist', async () => {
    const adapter = makeAdapter()
    await makeTwoWines(adapter)
    const wishlist = await adapter.listWines({ tag_wishlist: true })
    expect(wishlist).toHaveLength(1)
    expect(wishlist[0].denomination).toBe('Chablis')
  })

  it('filters by tag_wishlist false', async () => {
    const adapter = makeAdapter()
    await makeTwoWines(adapter)
    const notWishlist = await adapter.listWines({ tag_wishlist: false })
    expect(notWishlist).toHaveLength(1)
    expect(notWishlist[0].denomination).toBe('Muscadet')
  })

  it('filters by my_rating', async () => {
    const adapter = makeAdapter()
    await makeTwoWines(adapter)
    const okWines = await adapter.listWines({ my_rating: 'acceptable' })
    expect(okWines).toHaveLength(1)
    expect(okWines[0].denomination).toBe('Muscadet')
  })

  it('filters by region', async () => {
    const adapter = makeAdapter()
    await makeTwoWines(adapter)
    const burgundy = await adapter.listWines({ region: 'Burgundy' })
    expect(burgundy).toHaveLength(1)
    expect(burgundy[0].denomination).toBe('Chablis')
  })

  it('filters by has_tasting_note', async () => {
    const adapter = makeAdapter()
    await makeTwoWines(adapter)
    const wines = await adapter.listWines()
    const wineWithNote = wines[0]

    await adapter.createTastingNote({
      wine_id: wineWithNote.id,
      tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'good', free_text: null, tags: [],
    })

    const withNotes = await adapter.listWines({ has_tasting_note: true })
    expect(withNotes).toHaveLength(1)
    expect(withNotes[0].id).toBe(wineWithNote.id)
    expect(withNotes[0].latest_tasting_note_id).not.toBeNull()
  })
})

// Phase 9.4 — draft/promotion model
describe('draft/promotion (Phase 9.4)', () => {
  function draftInput(overrides: Partial<Parameters<SQLiteAdapter['createWine']>[0]> = {}) {
    return {
      producer: 'Test Draft', vintage: 2021, region: 'Burgundy', denomination: 'Volnay',
      grape_varieties: null, label_image_url: null,
      tag_discovered: false, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
      ...overrides,
    }
  }

  it('createWine always starts a wine unpromoted, regardless of supplied tags', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine(draftInput({ tag_discovered: true }))
    expect(wine.promoted_at).toBeNull()
  })

  it('excludes drafts from listWines by default', async () => {
    const adapter = makeAdapter()
    await adapter.createWine(draftInput())
    expect(await adapter.listWines()).toHaveLength(0)
  })

  it('includes drafts when include_drafts is set', async () => {
    const adapter = makeAdapter()
    await adapter.createWine(draftInput())
    expect(await adapter.listWines({ include_drafts: true })).toHaveLength(1)
  })

  it('getWine returns a draft regardless of promotion state', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine(draftInput())
    const fetched = await adapter.getWine(wine.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.promoted_at).toBeNull()
  })

  it('a wine becomes visible once promoted_at is set', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine(draftInput())
    await adapter.updateWine(wine.id, { tag_wishlist: true, promoted_at: new Date().toISOString() })
    const listed = await adapter.listWines()
    expect(listed.map((w) => w.id)).toContain(wine.id)
  })

  it('deleteWine removes the row', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine(draftInput())
    await adapter.deleteWine(wine.id)
    expect(await adapter.getWine(wine.id)).toBeNull()
  })

  it('sweepStaleDrafts deletes only drafts older than the cutoff, never promoted wines', async () => {
    const adapter = makeAdapter()
    const stale = await adapter.createWine(draftInput())
    const fresh = await adapter.createWine(draftInput({ denomination: 'Pommard' }))
    const promoted = await adapter.createWine(draftInput({ denomination: 'Meursault' }))
    await adapter.updateWine(promoted.id, { promoted_at: new Date().toISOString() })

    // Backdate the stale draft's date_added directly — createWine always
    // stamps "now", and the sweep's whole job is comparing against age.
    ;(adapter as unknown as { db: import('better-sqlite3').Database }).db
      .prepare('UPDATE wines SET date_added = ? WHERE id = ?')
      .run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), stale.id)

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const deleted = await adapter.sweepStaleDrafts(cutoff)

    expect(deleted).toBe(1)
    expect(await adapter.getWine(stale.id)).toBeNull()
    expect(await adapter.getWine(fresh.id)).not.toBeNull()
    expect(await adapter.getWine(promoted.id)).not.toBeNull()
  })
})

describe('updateWine', () => {
  it('updates specified fields without changing others', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'CVNE', vintage: 2017, region: 'Rioja', denomination: null,
      grape_varieties: ['Tempranillo'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    const updated = await adapter.updateWine(wine.id, {
      my_rating: 'good',
      my_tags: ['earthy', 'tobacco'],
    })

    expect(updated.my_rating).toBe('good')
    expect(updated.my_tags).toEqual(['earthy', 'tobacco'])
    expect(updated.producer).toBe('CVNE')
  })

  it('can toggle individual tags without changing other tags', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'DRC', vintage: 2018, region: 'Burgundy', denomination: 'Vosne-Romanée',
      grape_varieties: ['Pinot Noir'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    const updated = await adapter.updateWine(wine.id, {
      tag_wishlist: true,
      tag_cellar: true,
    })

    expect(updated.tag_discovered).toBe(true)
    expect(updated.tag_wishlist).toBe(true)
    expect(updated.tag_cellar).toBe(true)
    expect(updated.tag_consumed).toBe(false)
  })

  it('updates cellar_quantity directly on the wine', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'Rousseau', vintage: 2019, region: 'Burgundy', denomination: 'Gevrey-Chambertin',
      grape_varieties: ['Pinot Noir'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: true, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    const updated = await adapter.updateWine(wine.id, { cellar_quantity: 6 })
    expect(updated.cellar_quantity).toBe(6)

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.cellar_quantity).toBe(6)
  })

  it('throws when the wine does not exist', async () => {
    const adapter = makeAdapter()
    await expect(
      adapter.updateWine('00000000-0000-0000-0000-000000000000', { my_rating: 'good' })
    ).rejects.toThrow('Wine not found')
  })
})

// ─── Tasting notes ────────────────────────────────────────────────────────────

describe('tasting notes', () => {
  async function makeWine(adapter: SQLiteAdapter) {
    return adapter.createWine({
      producer: 'Georges Roumier', vintage: 2018, region: 'Burgundy',
      denomination: 'Chambolle-Musigny', grape_varieties: ['Pinot Noir'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: true, tag_consumed: false,
      cellar_quantity: 3, cellar_category: 'long_term', drinking_window: null,
      vintage_rating: 'very_good', my_rating: null, my_tags: [], wishlist_notes: null,
      price_paid: null, purchased_from: null, date_first_consumed: null,
      quality_classification: null, vineyard: null, cuvee: null,
    })
  }

  it('creates a tasting note linked to a wine', async () => {
    const adapter = makeAdapter()
    const wine = await makeWine(adapter)

    const note = await adapter.createTastingNote({
      wine_id: wine.id,
      tasted_at: '2025-12-25T20:00:00.000Z',
      clarity: 'clear', colour_intensity: 'medium', colour: 'ruby',
      nose_condition: 'clean', nose_intensity: 'medium_plus',
      nose_primary_aromas: ['cherry', 'raspberry'],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: ['forest floor', 'mushroom'],
      palate_sweetness: 'dry', palate_acidity: 'high', palate_tannin: 'medium',
      palate_body: 'medium', palate_flavour_intensity: 'medium_plus', palate_finish: 'long',
      quality_assessment: 'outstanding', my_rating: 'outstanding',
      free_text: 'Silky and complex. Needs time.',
      tags: ['burgundy', 'pinot-noir', 'great-vintage'],
    })

    expect(note.id).toBeTruthy()
    expect(note.wine_id).toBe(wine.id)
    expect(note.clarity).toBe('clear')
    expect(note.nose_primary_aromas).toEqual(['cherry', 'raspberry'])
    expect(note.nose_tertiary_aromas).toEqual(['forest floor', 'mushroom'])
    expect(note.tags).toEqual(['burgundy', 'pinot-noir', 'great-vintage'])
    expect(note.my_rating).toBe('outstanding')
  })

  it('retrieves a tasting note by id', async () => {
    const adapter = makeAdapter()
    const wine = await makeWine(adapter)

    const created = await adapter.createTastingNote({
      wine_id: wine.id, tasted_at: new Date().toISOString(),
      clarity: 'clear', colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'good', free_text: 'Quick note.', tags: [],
    })

    const fetched = await adapter.getTastingNote(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.my_rating).toBe('good')
  })

  it('returns null for unknown tasting note id', async () => {
    const adapter = makeAdapter()
    const result = await adapter.getTastingNote('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('lists all notes for a wine', async () => {
    const adapter = makeAdapter()
    const wine = await makeWine(adapter)

    await adapter.createTastingNote({
      wine_id: wine.id, tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'good', free_text: 'First note', tags: [],
    })
    await adapter.createTastingNote({
      wine_id: wine.id, tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'outstanding', free_text: 'Second note', tags: [],
    })

    const notes = await adapter.listTastingNotesByWine(wine.id)
    expect(notes).toHaveLength(2)
  })

  it('returns empty array for a wine with no notes', async () => {
    const adapter = makeAdapter()
    const notes = await adapter.listTastingNotesByWine('00000000-0000-0000-0000-000000000000')
    expect(notes).toEqual([])
  })

  it('sets latest_tasting_note_id on the parent wine after creation', async () => {
    const adapter = makeAdapter()
    const wine = await makeWine(adapter)

    const note = await adapter.createTastingNote({
      wine_id: wine.id, tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'good', free_text: null, tags: [],
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.latest_tasting_note_id).toBe(note.id)
  })

  it('sets tag_consumed to true on first note save', async () => {
    const adapter = makeAdapter()
    const wine = await makeWine(adapter)

    const before = await adapter.getWine(wine.id)
    expect(before!.tag_consumed).toBe(false)

    await adapter.createTastingNote({
      wine_id: wine.id, tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'good', free_text: null, tags: [],
    })

    const after = await adapter.getWine(wine.id)
    expect(after!.tag_consumed).toBe(true)
    expect(after!.date_first_consumed).toBeTruthy()
    expect(new Date(after!.date_first_consumed!).getTime()).not.toBeNaN()
  })

  it('does not overwrite date_first_consumed on subsequent notes', async () => {
    const adapter = makeAdapter()
    const wine = await makeWine(adapter)

    await adapter.createTastingNote({
      wine_id: wine.id, tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'good', free_text: 'First', tags: [],
    })

    const afterFirst = await adapter.getWine(wine.id)
    const firstConsumedDate = afterFirst!.date_first_consumed

    await adapter.createTastingNote({
      wine_id: wine.id, tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'outstanding', free_text: 'Second', tags: [],
    })

    const afterSecond = await adapter.getWine(wine.id)
    expect(afterSecond!.date_first_consumed).toBe(firstConsumedDate)
  })

  it('syncs tasting note tags to my_tags on the parent wine', async () => {
    const adapter = makeAdapter()
    const wine = await makeWine(adapter)

    await adapter.createTastingNote({
      wine_id: wine.id, tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: null, free_text: null,
      tags: ['elegant', 'long-finish', 'burgundy'],
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.my_tags).toEqual(['elegant', 'long-finish', 'burgundy'])
  })

  it('does not mix up notes between wines', async () => {
    const adapter = makeAdapter()
    const wine = await makeWine(adapter)
    const otherWine = await adapter.createWine({
      producer: null, vintage: 2020, region: 'Loire', denomination: null,
      grape_varieties: null, label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    await adapter.createTastingNote({
      wine_id: wine.id, tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: null, free_text: 'Note for first wine', tags: [],
    })

    const notes = await adapter.listTastingNotesByWine(otherWine.id)
    expect(notes).toHaveLength(0)
  })
})

// ─── Advice ───────────────────────────────────────────────────────────────────

describe('advice', () => {
  it('creates and retrieves an advice entry', async () => {
    const adapter = makeAdapter()
    const entry = await adapter.createAdvice({
      wine_id: null,
      source_name: 'Marco',
      source_role: 'sommelier',
      category: 'region',
      content: 'The 2018 vintage in Burgundy is exceptional across all levels.',
      captured_at: new Date().toISOString(),
    })

    expect(entry.id).toBeTruthy()
    expect(entry.wine_id).toBeNull()
    expect(entry.source_role).toBe('sommelier')
    expect(entry.category).toBe('region')

    const fetched = await adapter.getAdvice(entry.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.content).toBe('The 2018 vintage in Burgundy is exceptional across all levels.')
  })

  it('links advice to a wine entry', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: null, vintage: 2021, region: 'Burgundy', denomination: 'Meursault',
      grape_varieties: ['Chardonnay'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    const advice = await adapter.createAdvice({
      wine_id: wine.id,
      source_name: 'Sarah',
      source_role: 'friend',
      category: 'producer',
      content: 'The Coche-Dury Meursault is worth every penny.',
      captured_at: new Date().toISOString(),
    })

    expect(advice.wine_id).toBe(wine.id)

    const filtered = await adapter.listAdvice({ wine_id: wine.id })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(advice.id)
  })

  it('appends advice id to advice_linked on the parent wine', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'Leflaive', vintage: 2020, region: 'Burgundy', denomination: 'Puligny-Montrachet',
      grape_varieties: ['Chardonnay'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    const a1 = await adapter.createAdvice({
      wine_id: wine.id, source_name: 'Marco', source_role: 'sommelier', category: 'producer',
      content: 'Leflaive is the benchmark for white Burgundy.',
      captured_at: new Date().toISOString(),
    })
    const a2 = await adapter.createAdvice({
      wine_id: wine.id, source_name: 'Anna', source_role: 'merchant', category: 'vintage',
      content: '2020 is drinking beautifully already.',
      captured_at: new Date().toISOString(),
    })

    const updated = await adapter.getWine(wine.id)
    expect(updated!.advice_linked).toEqual([a1.id, a2.id])
  })

  it('does not set advice_linked when wine_id is null', async () => {
    const adapter = makeAdapter()
    await expect(
      adapter.createAdvice({
        wine_id: null, source_name: 'Tom', source_role: 'writer', category: 'region',
        content: 'Burgundy 2018 is exceptional.', captured_at: new Date().toISOString(),
      })
    ).resolves.toBeDefined()
  })

  it('filters advice by category', async () => {
    const adapter = makeAdapter()
    await adapter.createAdvice({
      wine_id: null, source_name: 'Tom', source_role: 'merchant', category: 'value',
      content: 'Great value under $30 right now.', captured_at: new Date().toISOString(),
    })
    await adapter.createAdvice({
      wine_id: null, source_name: 'Anna', source_role: 'writer', category: 'vintage',
      content: '2019 Barolo: exceptional.', captured_at: new Date().toISOString(),
    })

    const valueAdvice = await adapter.listAdvice({ category: 'value' })
    expect(valueAdvice).toHaveLength(1)
    expect(valueAdvice[0].source_name).toBe('Tom')
  })

  it('returns null for unknown advice id', async () => {
    const adapter = makeAdapter()
    const result = await adapter.getAdvice('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })
})

// ─── Serialization round-trips ────────────────────────────────────────────────

describe('serialization round-trips', () => {
  it('preserves arrays through SQLite (JSON-encoded columns)', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'Château Rayas', vintage: 2010, region: 'Southern Rhône',
      denomination: 'Châteauneuf-du-Pape',
      grape_varieties: ['Grenache', 'Mourvèdre', 'Syrah'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: ['powerful', 'age-worthy', 'southern-rhône'],
      wishlist_notes: null, price_paid: null, purchased_from: null, date_first_consumed: null,
      quality_classification: null, vineyard: null, cuvee: null,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.grape_varieties).toEqual(['Grenache', 'Mourvèdre', 'Syrah'])
    expect(fetched!.my_tags).toEqual(['powerful', 'age-worthy', 'southern-rhône'])
  })

  // review_data is a JSON TEXT column, so Phase 9.1's page_vintage /
  // vintage_gap / match keys needed no migration — but "no migration needed"
  // is exactly the claim worth a test, since nothing else would catch the
  // adapter silently dropping a nested object on the way back out.
  it('round-trips review_data including the Phase 9.1 match verdict', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'Domaine Charles Audoin', vintage: 2022, region: 'Burgundy',
      denomination: 'Marsannay', grape_varieties: ['Pinot Noir'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    // Benchmark's only Charles Audoin page is the 2020 — stored and labelled,
    // not discarded. That is the whole point of vintage_gap.
    const review_data: RetailerReview[] = [
      {
        slug: 'benchmark',
        name: 'Benchmark Wine Group',
        product_url: 'https://www.benchmarkwine.com/products/charles-audoin-marsannay-clos-du-roy-2020',
        critic_scores: [
          { publication: 'Vinous', score: 91, known_publication: true, drinking_window: null, vintage_character: null, deal: false },
        ],
        fetched_at: '2026-08-04T00:00:00.000Z',
        source: 'configured',
        page_vintage: 2020,
        vintage_gap: 2,
        match: {
          producer: 'match',
          denomination: 'match',
          bottling: 'unknown',
          vintage: 'mismatch',
          candidateVintage: 2020,
          vintageGap: 2,
        },
        page_price: 65,
      },
    ]

    await adapter.updateWine(wine.id, { review_data })
    const fetched = await adapter.getWine(wine.id)

    expect(fetched!.review_data).toEqual(review_data)
    expect(fetched!.review_data![0].match.vintage).toBe('mismatch')
    expect(fetched!.review_data![0].vintage_gap).toBe(2)
  })

  // Phase 9.2 (WI-5): review_probe_log is a new JSON TEXT column
  // (migration 004). Same "no migration needed for a nested value" claim as
  // review_data above, worth its own test since the two columns are written
  // by separate arguments in the adapter's positional SQL params — a
  // transposition there wouldn't be caught by testing only one.
  it('round-trips review_probe_log', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'Sokolin Test', vintage: 2019, region: 'Burgundy',
      denomination: 'Gevrey-Chambertin', grape_varieties: null, label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    const review_probe_log = [
      { slug: 'sokolin', domain: 'sokolin.com', stage: 'zero_results' as const, variants_tried: 3, probed_at: '2026-08-12T00:00:00.000Z' },
      { slug: 'benchmark', domain: 'benchmarkwine.com', stage: 'found' as const, variants_tried: 1, probed_at: '2026-08-12T00:00:00.000Z' },
    ]

    await adapter.updateWine(wine.id, { review_probe_log })
    const fetched = await adapter.getWine(wine.id)

    expect(fetched!.review_probe_log).toEqual(review_probe_log)
  })

  it('preserves null optional fields', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: null, vintage: null, region: null, denomination: null,
      grape_varieties: null, label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
      cellar_quantity: 0, cellar_category: null, drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.producer).toBeNull()
    expect(fetched!.vintage).toBeNull()
    expect(fetched!.region).toBeNull()
    expect(fetched!.drinking_window).toBeNull()
    expect(fetched!.my_rating).toBeNull()
    expect(fetched!.latest_tasting_note_id).toBeNull()
    expect(fetched!.advice_linked).toBeNull()
    expect(fetched!.expert_reviews).toBeNull()
    expect(fetched!.community_sentiment).toBeNull()
    expect(fetched!.community_excerpts).toBeNull()
    expect(fetched!.price_data).toBeNull()
    expect(fetched!.review_probe_log).toBeNull()
    expect(fetched!.wishlist_notes).toBeNull()
    expect(fetched!.price_paid).toBeNull()
    expect(fetched!.purchased_from).toBeNull()
    expect(fetched!.quality_classification).toBeNull()
    expect(fetched!.vineyard).toBeNull()
    expect(fetched!.date_first_consumed).toBeNull()
  })

  it('preserves tag booleans through serialization', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'Roumier', vintage: 2018, region: 'Burgundy', denomination: 'Chambolle-Musigny',
      grape_varieties: ['Pinot Noir'], label_image_url: null,
      tag_discovered: true, tag_wishlist: true, tag_cellar: true, tag_consumed: false,
      cellar_quantity: 3, cellar_category: 'near_term', drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: null,
      purchased_from: null, date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.tag_discovered).toBe(true)
    expect(fetched!.tag_wishlist).toBe(true)
    expect(fetched!.tag_cellar).toBe(true)
    expect(fetched!.tag_consumed).toBe(false)
    expect(fetched!.cellar_quantity).toBe(3)
    expect(typeof fetched!.cellar_quantity).toBe('number')
  })

  it('preserves drinking window date range', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'DRC', vintage: 2015, region: 'Burgundy', denomination: 'Échézeaux',
      grape_varieties: ['Pinot Noir'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: true, tag_consumed: false,
      cellar_quantity: 0, cellar_category: 'long_term',
      drinking_window: { start: '2025-01-01', end: '2045-12-31' },
      vintage_rating: 'very_good', my_rating: null, my_tags: [], wishlist_notes: null,
      price_paid: null, purchased_from: null, date_first_consumed: null,
      quality_classification: null, vineyard: null, cuvee: null,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.drinking_window).toEqual({ start: '2025-01-01', end: '2045-12-31' })
  })

  it('preserves numeric fields (vintage, cellar_quantity, price_paid)', async () => {
    const adapter = makeAdapter()
    const wine = await adapter.createWine({
      producer: 'Bartolo Mascarello', vintage: 2013, region: 'Piedmont', denomination: 'Barolo',
      grape_varieties: ['Nebbiolo'], label_image_url: null,
      tag_discovered: true, tag_wishlist: false, tag_cellar: true, tag_consumed: false,
      cellar_quantity: 12, cellar_category: 'long_term', drinking_window: null, vintage_rating: null,
      my_rating: null, my_tags: [], wishlist_notes: null, price_paid: 189.99,
      purchased_from: 'Flatiron Wines', date_first_consumed: null, quality_classification: null,
      vineyard: null, cuvee: null,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.vintage).toBe(2013)
    expect(fetched!.cellar_quantity).toBe(12)
    expect(fetched!.price_paid).toBe(189.99)
    expect(typeof fetched!.vintage).toBe('number')
    expect(typeof fetched!.cellar_quantity).toBe('number')
    expect(typeof fetched!.price_paid).toBe('number')
  })
})
