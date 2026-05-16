/**
 * Integration tests for SheetsAdapter against a real Google Sheet.
 *
 * Requirements:
 *   GOOGLE_SHEETS_CREDENTIALS  — path to service account JSON
 *   GOOGLE_SHEETS_SPREADSHEET_ID — ID of a sheet with 5 tabs:
 *                                   wines, cellar, wishlist, tasting_notes, advice
 *
 * Run with: npm run test:integration
 *
 * These tests write real rows to the spreadsheet. The rows are identifiable by
 * the "INTEGRATION_TEST" prefix in the wine name. Manual cleanup may be needed.
 */
import { SheetsAdapter } from '../../sheets/SheetsAdapter'
import { createSheetsClient } from '../../sheets/client'
import type { SheetsClientInterface } from '../../sheets/SheetsAdapter'

const SKIP =
  !process.env.GOOGLE_SHEETS_CREDENTIALS || !process.env.GOOGLE_SHEETS_SPREADSHEET_ID

const maybeDescribe = SKIP ? describe.skip : describe

if (SKIP) {
  test('integration tests skipped — GOOGLE_SHEETS_CREDENTIALS or GOOGLE_SHEETS_SPREADSHEET_ID not set', () => {
    expect(true).toBe(true)
  })
}

maybeDescribe('SheetsAdapter (integration)', () => {
  let adapter: SheetsAdapter

  beforeAll(async () => {
    jest.setTimeout(30000)
    const client = createSheetsClient() as unknown as SheetsClientInterface
    adapter = new SheetsAdapter(client, process.env.GOOGLE_SHEETS_SPREADSHEET_ID!)
    await adapter.setupHeaders()
  })

  it('full lifecycle: create → list → update → promote → consume', async () => {
    const wine = await adapter.createWine({
      name: 'INTEGRATION_TEST Chambolle-Musigny',
      producer: 'Georges Roumier',
      vintage: 2018,
      region: 'Burgundy',
      denomination: 'Chambolle-Musigny',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      status: 'discovered',
      cellar_category: null,
      drinking_window: { start: '2028-01-01', end: '2045-12-31' },
      vintage_rating: 'very_good',
      my_rating: null,
      my_tags: ['elegant', 'floral'],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
      quality_classification: null,
      vineyard: null,
    })

    expect(wine.id).toBeTruthy()

    // Retrieve it
    const fetched = await adapter.getWine(wine.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.name).toBe('INTEGRATION_TEST Chambolle-Musigny')
    expect(fetched!.grape_varieties).toEqual(['Pinot Noir'])
    expect(fetched!.drinking_window?.start).toBe('2028-01-01')

    // Update rating
    const updated = await adapter.updateWine(wine.id, { my_rating: 'great' })
    expect(updated.my_rating).toBe('great')

    // Verify update persisted
    const refetched = await adapter.getWine(wine.id)
    expect(refetched!.my_rating).toBe('great')

    // Status lifecycle
    const onWishlist = await adapter.promoteWine(wine.id, 'wishlist')
    expect(onWishlist.status).toBe('wishlist')

    const inCellar = await adapter.promoteWine(wine.id, 'cellar')
    expect(inCellar.status).toBe('cellar')

    const consumed = await adapter.promoteWine(wine.id, 'consumed')
    expect(consumed.status).toBe('consumed')
    expect(consumed.date_consumed).toBeTruthy()

    // Verify final state persisted
    const final = await adapter.getWine(wine.id)
    expect(final!.status).toBe('consumed')
    expect(final!.date_consumed).toBeTruthy()
  })

  it('creates and retrieves a tasting note', async () => {
    const wine = await adapter.createWine({
      name: 'INTEGRATION_TEST Barolo',
      producer: 'Giacomo Conterno',
      vintage: 2016,
      region: 'Piedmont',
      denomination: 'Barolo',
      grape_varieties: ['Nebbiolo'],
      label_image_url: null,
      status: 'cellar',
      cellar_category: 'long_term',
      drinking_window: null,
      vintage_rating: 'very_good',
      my_rating: null,
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
      quality_classification: null,
      vineyard: null,
    })

    const note = await adapter.createTastingNote({
      wine_id: wine.id,
      tasted_at: new Date().toISOString(),
      clarity: 'clear',
      colour_intensity: 'deep',
      colour: 'garnet',
      nose_condition: 'clean',
      nose_intensity: 'pronounced',
      nose_primary_aromas: ['tar', 'rose', 'cherry'],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: ['tobacco', 'leather'],
      palate_sweetness: 'dry',
      palate_acidity: 'high',
      palate_tannin: 'high',
      palate_body: 'full',
      palate_flavour_intensity: 'pronounced',
      palate_finish: 'long',
      quality_assessment: 'outstanding',
      my_rating: 'great',
      free_text: 'Needs 10+ years. Extraordinary potential.',
      tags: ['barolo', 'nebbiolo', 'cellar-candidate'],
    })

    const notes = await adapter.listTastingNotesByWine(wine.id)
    expect(notes.length).toBeGreaterThanOrEqual(1)
    const found = notes.find((n) => n.id === note.id)
    expect(found).toBeDefined()
    expect(found!.nose_primary_aromas).toEqual(['tar', 'rose', 'cherry'])
    expect(found!.tags).toContain('barolo')

    // tasting_note_id and my_tags should be written back to the wine
    const updatedWine = await adapter.getWine(wine.id)
    expect(updatedWine!.tasting_note_id).toBe(note.id)
    expect(updatedWine!.my_tags).toContain('barolo')
  })

  it('creates an advice entry and filters by wine', async () => {
    const wine = await adapter.createWine({
      name: 'INTEGRATION_TEST Meursault',
      producer: null,
      vintage: 2021,
      region: 'Burgundy',
      denomination: 'Meursault',
      grape_varieties: ['Chardonnay'],
      label_image_url: null,
      status: 'discovered',
      cellar_category: null,
      drinking_window: null,
      vintage_rating: null,
      my_rating: null,
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
      quality_classification: null,
      vineyard: null,
    })

    const advice = await adapter.createAdvice({
      wine_id: wine.id,
      source_name: 'Sommelier at Le Bernardin',
      source_role: 'sommelier',
      category: 'producer',
      content: 'Coche-Dury Meursault is the benchmark. Buy at any price.',
      captured_at: new Date().toISOString(),
    })

    const filtered = await adapter.listAdvice({ wine_id: wine.id })
    expect(filtered.length).toBeGreaterThanOrEqual(1)
    const found = filtered.find((a) => a.id === advice.id)
    expect(found).toBeDefined()
    expect(found!.source_role).toBe('sommelier')
  })

  it('manages cellar entry quantity', async () => {
    const wine = await adapter.createWine({
      name: 'INTEGRATION_TEST Nuits-Saint-Georges',
      producer: null,
      vintage: 2019,
      region: 'Burgundy',
      denomination: 'Nuits-Saint-Georges',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      status: 'cellar',
      cellar_category: 'near_term',
      drinking_window: null,
      vintage_rating: null,
      my_rating: null,
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
      quality_classification: null,
      vineyard: null,
    })

    const entry = await adapter.upsertCellarEntry(wine.id, {
      quantity: 6,
      location_notes: 'Integration test rack',
      date_acquired: '2024-01-01',
      price_paid: 55.0,
      purchased_from: 'Test Retailer',
    })

    expect(entry.quantity).toBe(6)

    const reduced = await adapter.upsertCellarEntry(wine.id, {
      quantity: 5,
      location_notes: entry.location_notes,
      date_acquired: entry.date_acquired,
      price_paid: entry.price_paid,
      purchased_from: entry.purchased_from,
    })

    expect(reduced.quantity).toBe(5)

    const fetched = await adapter.getCellarEntry(wine.id)
    expect(fetched!.quantity).toBe(5)
  })
})
