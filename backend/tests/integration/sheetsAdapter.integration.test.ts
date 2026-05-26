/**
 * Integration tests for SheetsAdapter against a real Google Sheet.
 *
 * Requirements:
 *   GOOGLE_SHEETS_CREDENTIALS  — path to service account JSON
 *   GOOGLE_SHEETS_SPREADSHEET_ID — ID of a sheet with 3 tabs:
 *                                   wines, tasting_notes, advice
 *
 * Run with: npm run test:integration
 *
 * These tests write real rows to the spreadsheet. Manual cleanup may be needed.
 */
import { SheetsAdapter } from '../../sheets/SheetsAdapter'
import { createSheetsClient } from '../../sheets/client'
import type { SheetsClientInterface } from '../../sheets/SheetsAdapter'

// Phase 5+: Sheets adapter is no longer the active storage path.
// These tests require real credentials and an active spreadsheet.
// Opt in by setting SHEETS_INTEGRATION=true in your environment.
const SKIP =
  process.env.SHEETS_INTEGRATION !== 'true' ||
  !process.env.GOOGLE_SHEETS_CREDENTIALS ||
  !process.env.GOOGLE_SHEETS_SPREADSHEET_ID

const maybeDescribe = SKIP ? describe.skip : describe

if (SKIP) {
  test('sheets integration tests skipped — set SHEETS_INTEGRATION=true to enable', () => {
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

  it('full lifecycle: create → list → update tags → add note', async () => {
    const wine = await adapter.createWine({
      producer: 'Georges Roumier',
      vintage: 2018,
      region: 'Burgundy',
      denomination: 'Chambolle-Musigny',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: false,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: null,
      drinking_window: { start: '2028-01-01', end: '2045-12-31' },
      vintage_rating: 'very_good',
      my_rating: null,
      my_tags: ['elegant', 'floral'],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })

    expect(wine.id).toBeTruthy()

    // Retrieve it
    const fetched = await adapter.getWine(wine.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.denomination).toBe('Chambolle-Musigny')
    expect(fetched!.grape_varieties).toEqual(['Pinot Noir'])
    expect(fetched!.drinking_window?.start).toBe('2028-01-01')

    // Update rating
    const updated = await adapter.updateWine(wine.id, { my_rating: 'outstanding' })
    expect(updated.my_rating).toBe('outstanding')

    // Verify update persisted
    const refetched = await adapter.getWine(wine.id)
    expect(refetched!.my_rating).toBe('outstanding')

    // Add to wishlist and cellar via tag toggles
    const onWishlist = await adapter.updateWine(wine.id, { tag_wishlist: true })
    expect(onWishlist.tag_wishlist).toBe(true)

    const inCellar = await adapter.updateWine(wine.id, { tag_cellar: true, cellar_quantity: 6 })
    expect(inCellar.tag_cellar).toBe(true)
    expect(inCellar.cellar_quantity).toBe(6)

    // Verify final state persisted
    const final = await adapter.getWine(wine.id)
    expect(final!.tag_discovered).toBe(true)
    expect(final!.tag_wishlist).toBe(true)
    expect(final!.tag_cellar).toBe(true)
    expect(final!.cellar_quantity).toBe(6)
  })

  it('creates and retrieves a tasting note', async () => {
    const wine = await adapter.createWine({
      producer: 'Giacomo Conterno',
      vintage: 2016,
      region: 'Piedmont',
      denomination: 'Barolo',
      grape_varieties: ['Nebbiolo'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: true,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: 'long_term',
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
      my_rating: 'outstanding',
      free_text: 'Needs 10+ years. Extraordinary potential.',
      tags: ['barolo', 'nebbiolo', 'cellar-candidate'],
    })

    const notes = await adapter.listTastingNotesByWine(wine.id)
    expect(notes.length).toBeGreaterThanOrEqual(1)
    const found = notes.find((n) => n.id === note.id)
    expect(found).toBeDefined()
    expect(found!.nose_primary_aromas).toEqual(['tar', 'rose', 'cherry'])
    expect(found!.tags).toContain('barolo')

    // latest_tasting_note_id, my_tags, and tag_consumed should be written back to the wine
    const updatedWine = await adapter.getWine(wine.id)
    expect(updatedWine!.latest_tasting_note_id).toBe(note.id)
    expect(updatedWine!.my_tags).toContain('barolo')
    expect(updatedWine!.tag_consumed).toBe(true)
    expect(updatedWine!.date_first_consumed).toBeTruthy()
  })

  it('creates an advice entry and filters by wine', async () => {
    const wine = await adapter.createWine({
      producer: null,
      vintage: 2021,
      region: 'Burgundy',
      denomination: 'Meursault',
      grape_varieties: ['Chardonnay'],
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

  it('manages cellar_quantity directly on the wine', async () => {
    const wine = await adapter.createWine({
      producer: null,
      vintage: 2019,
      region: 'Burgundy',
      denomination: 'Nuits-Saint-Georges',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: true,
      tag_consumed: false,
      cellar_quantity: 6,
      cellar_category: 'near_term',
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

    expect(wine.cellar_quantity).toBe(6)

    const reduced = await adapter.updateWine(wine.id, { cellar_quantity: 5 })
    expect(reduced.cellar_quantity).toBe(5)

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.cellar_quantity).toBe(5)
    expect(typeof fetched!.cellar_quantity).toBe('number')
  })
})
