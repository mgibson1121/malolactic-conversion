/**
 * Unit tests for SheetsAdapter. All Google Sheets API calls are replaced by an
 * in-memory mock so no credentials are required.
 */
import { SheetsAdapter } from '../SheetsAdapter'
import type { SheetsClientInterface } from '../SheetsAdapter'

// ─── In-memory mock for the Google Sheets values API ─────────────────────────

class MockSheetsClient implements SheetsClientInterface {
  /** Backing store: sheet name → array of data rows (no header row). */
  private data: Record<string, string[][]> = {
    wines: [],
    tasting_notes: [],
    advice: [],
  }

  spreadsheets = {
    values: {
      get: async ({ range }: { range: string }) => {
        const sheetName = range.split('!')[0]
        return { data: { values: this.data[sheetName] ?? [] } }
      },

      append: async ({
        range,
        requestBody,
      }: {
        spreadsheetId: string
        range: string
        valueInputOption: string
        requestBody: { values: string[][] }
      }) => {
        const sheetName = range.split('!')[0]
        if (!this.data[sheetName]) this.data[sheetName] = []
        this.data[sheetName].push(...requestBody.values)
        return { data: {} }
      },

      update: async ({
        range,
        requestBody,
      }: {
        spreadsheetId: string
        range: string
        valueInputOption: string
        requestBody: { values: string[][] }
      }) => {
        // range looks like "wines!A3:Z3" — row 3 = data index 1 (3 - 2)
        const sheetName = range.split('!')[0]
        const match = range.match(/A(\d+)/)
        if (match) {
          const dataIndex = parseInt(match[1], 10) - 2
          if (this.data[sheetName]?.[dataIndex] !== undefined) {
            this.data[sheetName][dataIndex] = requestBody.values[0]
          }
        }
        return { data: {} }
      },
    },
  }

  reset() {
    for (const key of Object.keys(this.data)) this.data[key] = []
  }
}

// ─── Test setup ───────────────────────────────────────────────────────────────

let mockClient: MockSheetsClient
let adapter: SheetsAdapter

beforeEach(() => {
  mockClient = new MockSheetsClient()
  adapter = new SheetsAdapter(mockClient, 'test-spreadsheet-id')
})

// ─── Wine CRUD ────────────────────────────────────────────────────────────────

describe('createWine', () => {
  it('assigns an id and date_added', async () => {
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
    expect(wine.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(wine.date_added).toBeTruthy()
    expect(new Date(wine.date_added).getTime()).not.toBeNaN()
  })

  it('preserves all optional fields', async () => {
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
    const result = await adapter.getWine('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })
})

describe('listWines', () => {
  beforeEach(async () => {
    await adapter.createWine({
      producer: null,
      vintage: 2022,
      region: 'Loire',
      denomination: 'Muscadet',
      grape_varieties: ['Melon de Bourgogne'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: false,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: null,
      drinking_window: null,
      vintage_rating: null,
      my_rating: 'acceptable',
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })
    await adapter.createWine({
      producer: 'Raveneau',
      vintage: 2020,
      region: 'Burgundy',
      denomination: 'Chablis',
      grape_varieties: ['Chardonnay'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: true,
      tag_cellar: false,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: null,
      drinking_window: null,
      vintage_rating: 'good',
      my_rating: null,
      my_tags: ['minerally'],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })
  })

  it('returns all wines without a filter', async () => {
    const wines = await adapter.listWines()
    expect(wines).toHaveLength(2)
  })

  it('filters by tag_discovered', async () => {
    const discovered = await adapter.listWines({ tag_discovered: true })
    expect(discovered).toHaveLength(2)
  })

  it('filters by tag_wishlist', async () => {
    const wishlist = await adapter.listWines({ tag_wishlist: true })
    expect(wishlist).toHaveLength(1)
    expect(wishlist[0].denomination).toBe('Chablis')
  })

  it('filters by tag_wishlist false', async () => {
    const notWishlist = await adapter.listWines({ tag_wishlist: false })
    expect(notWishlist).toHaveLength(1)
    expect(notWishlist[0].denomination).toBe('Muscadet')
  })

  it('filters by my_rating', async () => {
    const okWines = await adapter.listWines({ my_rating: 'acceptable' })
    expect(okWines).toHaveLength(1)
    expect(okWines[0].denomination).toBe('Muscadet')
  })

  it('filters by region', async () => {
    const burgundy = await adapter.listWines({ region: 'Burgundy' })
    expect(burgundy).toHaveLength(1)
    expect(burgundy[0].denomination).toBe('Chablis')
  })

  it('filters by has_tasting_note', async () => {
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

describe('updateWine', () => {
  it('updates specified fields without changing others', async () => {
    const wine = await adapter.createWine({
      producer: 'CVNE',
      vintage: 2017,
      region: 'Rioja',
      denomination: null,
      grape_varieties: ['Tempranillo'],
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

    const updated = await adapter.updateWine(wine.id, {
      my_rating: 'good',
      my_tags: ['earthy', 'tobacco'],
    })

    expect(updated.my_rating).toBe('good')
    expect(updated.my_tags).toEqual(['earthy', 'tobacco'])
    expect(updated.producer).toBe('CVNE')
  })

  it('can toggle individual tags without changing other tags', async () => {
    const wine = await adapter.createWine({
      producer: 'DRC',
      vintage: 2018,
      region: 'Burgundy',
      denomination: 'Vosne-Romanée',
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
    const wine = await adapter.createWine({
      producer: 'Rousseau',
      vintage: 2019,
      region: 'Burgundy',
      denomination: 'Gevrey-Chambertin',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: true,
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

    const updated = await adapter.updateWine(wine.id, { cellar_quantity: 6 })
    expect(updated.cellar_quantity).toBe(6)

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.cellar_quantity).toBe(6)
  })

  it('throws when the wine does not exist', async () => {
    await expect(
      adapter.updateWine('00000000-0000-0000-0000-000000000000', { my_rating: 'good' })
    ).rejects.toThrow('Wine not found')
  })
})

// ─── Tasting notes ────────────────────────────────────────────────────────────

describe('tasting notes', () => {
  let wineId: string

  beforeEach(async () => {
    const wine = await adapter.createWine({
      producer: 'Georges Roumier',
      vintage: 2018,
      region: 'Burgundy',
      denomination: 'Chambolle-Musigny',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: true,
      tag_consumed: false,
      cellar_quantity: 3,
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
    wineId = wine.id
  })

  it('creates a tasting note linked to a wine', async () => {
    const note = await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: '2025-12-25T20:00:00.000Z',
      clarity: 'clear',
      colour_intensity: 'medium',
      colour: 'ruby',
      nose_condition: 'clean',
      nose_intensity: 'medium_plus',
      nose_primary_aromas: ['cherry', 'raspberry'],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: ['forest floor', 'mushroom'],
      palate_sweetness: 'dry',
      palate_acidity: 'high',
      palate_tannin: 'medium',
      palate_body: 'medium',
      palate_flavour_intensity: 'medium_plus',
      palate_finish: 'long',
      quality_assessment: 'outstanding',
      my_rating: 'outstanding',
      free_text: 'Silky and complex. Needs time.',
      tags: ['burgundy', 'pinot-noir', 'great-vintage'],
    })

    expect(note.id).toBeTruthy()
    expect(note.wine_id).toBe(wineId)
    expect(note.clarity).toBe('clear')
    expect(note.nose_primary_aromas).toEqual(['cherry', 'raspberry'])
    expect(note.nose_tertiary_aromas).toEqual(['forest floor', 'mushroom'])
    expect(note.tags).toEqual(['burgundy', 'pinot-noir', 'great-vintage'])
    expect(note.my_rating).toBe('outstanding')
  })

  it('retrieves a tasting note by id', async () => {
    const created = await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: new Date().toISOString(),
      clarity: 'clear',
      colour_intensity: null,
      colour: null,
      nose_condition: null,
      nose_intensity: null,
      nose_primary_aromas: [],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: [],
      palate_sweetness: null,
      palate_acidity: null,
      palate_tannin: null,
      palate_body: null,
      palate_flavour_intensity: null,
      palate_finish: null,
      quality_assessment: null,
      my_rating: 'good',
      free_text: 'Quick note.',
      tags: [],
    })

    const fetched = await adapter.getTastingNote(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.my_rating).toBe('good')
  })

  it('returns null for unknown tasting note id', async () => {
    const result = await adapter.getTastingNote('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('lists all notes for a wine', async () => {
    await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: new Date().toISOString(),
      clarity: null,
      colour_intensity: null,
      colour: null,
      nose_condition: null,
      nose_intensity: null,
      nose_primary_aromas: [],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: [],
      palate_sweetness: null,
      palate_acidity: null,
      palate_tannin: null,
      palate_body: null,
      palate_flavour_intensity: null,
      palate_finish: null,
      quality_assessment: null,
      my_rating: 'good',
      free_text: 'First note',
      tags: [],
    })
    await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: new Date().toISOString(),
      clarity: null,
      colour_intensity: null,
      colour: null,
      nose_condition: null,
      nose_intensity: null,
      nose_primary_aromas: [],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: [],
      palate_sweetness: null,
      palate_acidity: null,
      palate_tannin: null,
      palate_body: null,
      palate_flavour_intensity: null,
      palate_finish: null,
      quality_assessment: null,
      my_rating: 'outstanding',
      free_text: 'Second note',
      tags: [],
    })

    const notes = await adapter.listTastingNotesByWine(wineId)
    expect(notes).toHaveLength(2)
  })

  it('returns empty array for a wine with no notes', async () => {
    const notes = await adapter.listTastingNotesByWine('00000000-0000-0000-0000-000000000000')
    expect(notes).toEqual([])
  })

  it('sets latest_tasting_note_id on the parent wine after creation', async () => {
    const note = await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: new Date().toISOString(),
      clarity: null,
      colour_intensity: null,
      colour: null,
      nose_condition: null,
      nose_intensity: null,
      nose_primary_aromas: [],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: [],
      palate_sweetness: null,
      palate_acidity: null,
      palate_tannin: null,
      palate_body: null,
      palate_flavour_intensity: null,
      palate_finish: null,
      quality_assessment: null,
      my_rating: 'good',
      free_text: null,
      tags: [],
    })

    const wine = await adapter.getWine(wineId)
    expect(wine!.latest_tasting_note_id).toBe(note.id)
  })

  it('sets tag_consumed to true on first note save', async () => {
    const before = await adapter.getWine(wineId)
    expect(before!.tag_consumed).toBe(false)

    await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: new Date().toISOString(),
      clarity: null,
      colour_intensity: null,
      colour: null,
      nose_condition: null,
      nose_intensity: null,
      nose_primary_aromas: [],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: [],
      palate_sweetness: null,
      palate_acidity: null,
      palate_tannin: null,
      palate_body: null,
      palate_flavour_intensity: null,
      palate_finish: null,
      quality_assessment: null,
      my_rating: 'good',
      free_text: null,
      tags: [],
    })

    const after = await adapter.getWine(wineId)
    expect(after!.tag_consumed).toBe(true)
    expect(after!.date_first_consumed).toBeTruthy()
    expect(new Date(after!.date_first_consumed!).getTime()).not.toBeNaN()
  })

  it('does not overwrite date_first_consumed on subsequent notes', async () => {
    await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'good', free_text: 'First', tags: [],
    })

    const afterFirst = await adapter.getWine(wineId)
    const firstConsumedDate = afterFirst!.date_first_consumed

    await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: new Date().toISOString(),
      clarity: null, colour_intensity: null, colour: null,
      nose_condition: null, nose_intensity: null,
      nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
      palate_sweetness: null, palate_acidity: null, palate_tannin: null,
      palate_body: null, palate_flavour_intensity: null, palate_finish: null,
      quality_assessment: null, my_rating: 'outstanding', free_text: 'Second', tags: [],
    })

    const afterSecond = await adapter.getWine(wineId)
    expect(afterSecond!.date_first_consumed).toBe(firstConsumedDate)
  })

  it('syncs tasting note tags to my_tags on the parent wine', async () => {
    await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: new Date().toISOString(),
      clarity: null,
      colour_intensity: null,
      colour: null,
      nose_condition: null,
      nose_intensity: null,
      nose_primary_aromas: [],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: [],
      palate_sweetness: null,
      palate_acidity: null,
      palate_tannin: null,
      palate_body: null,
      palate_flavour_intensity: null,
      palate_finish: null,
      quality_assessment: null,
      my_rating: null,
      free_text: null,
      tags: ['elegant', 'long-finish', 'burgundy'],
    })

    const wine = await adapter.getWine(wineId)
    expect(wine!.my_tags).toEqual(['elegant', 'long-finish', 'burgundy'])
  })

  it('does not mix up notes between wines', async () => {
    const otherWine = await adapter.createWine({
      producer: null,
      vintage: 2020,
      region: 'Loire',
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

    await adapter.createTastingNote({
      wine_id: wineId,
      tasted_at: new Date().toISOString(),
      clarity: null,
      colour_intensity: null,
      colour: null,
      nose_condition: null,
      nose_intensity: null,
      nose_primary_aromas: [],
      nose_secondary_aromas: [],
      nose_tertiary_aromas: [],
      palate_sweetness: null,
      palate_acidity: null,
      palate_tannin: null,
      palate_body: null,
      palate_flavour_intensity: null,
      palate_finish: null,
      quality_assessment: null,
      my_rating: null,
      free_text: 'Note for first wine',
      tags: [],
    })

    const notes = await adapter.listTastingNotesByWine(otherWine.id)
    expect(notes).toHaveLength(0)
  })
})

// ─── Advice ───────────────────────────────────────────────────────────────────

describe('advice', () => {
  it('creates and retrieves an advice entry', async () => {
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
    const wine = await adapter.createWine({
      producer: 'Leflaive',
      vintage: 2020,
      region: 'Burgundy',
      denomination: 'Puligny-Montrachet',
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

    const a1 = await adapter.createAdvice({
      wine_id: wine.id,
      source_name: 'Marco',
      source_role: 'sommelier',
      category: 'producer',
      content: 'Leflaive is the benchmark for white Burgundy.',
      captured_at: new Date().toISOString(),
    })
    const a2 = await adapter.createAdvice({
      wine_id: wine.id,
      source_name: 'Anna',
      source_role: 'merchant',
      category: 'vintage',
      content: '2020 is drinking beautifully already.',
      captured_at: new Date().toISOString(),
    })

    const updated = await adapter.getWine(wine.id)
    expect(updated!.advice_linked).toEqual([a1.id, a2.id])
  })

  it('does not set advice_linked when wine_id is null', async () => {
    await adapter.createAdvice({
      wine_id: null,
      source_name: 'Tom',
      source_role: 'writer',
      category: 'region',
      content: 'Burgundy 2018 is exceptional.',
      captured_at: new Date().toISOString(),
    })
    // No wine to check — just verify no error is thrown
  })

  it('filters advice by category', async () => {
    await adapter.createAdvice({
      wine_id: null,
      source_name: 'Tom',
      source_role: 'merchant',
      category: 'value',
      content: 'Great value under $30 right now.',
      captured_at: new Date().toISOString(),
    })
    await adapter.createAdvice({
      wine_id: null,
      source_name: 'Anna',
      source_role: 'writer',
      category: 'vintage',
      content: '2019 Barolo: exceptional.',
      captured_at: new Date().toISOString(),
    })

    const valueAdvice = await adapter.listAdvice({ category: 'value' })
    expect(valueAdvice).toHaveLength(1)
    expect(valueAdvice[0].source_name).toBe('Tom')
  })

  it('returns null for unknown advice id', async () => {
    const result = await adapter.getAdvice('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })
})

// ─── Serialization round-trips ────────────────────────────────────────────────

describe('serialization round-trips', () => {
  it('preserves arrays through Google Sheets (JSON-encoded cells)', async () => {
    const wine = await adapter.createWine({
      producer: 'Château Rayas',
      vintage: 2010,
      region: 'Southern Rhône',
      denomination: 'Châteauneuf-du-Pape',
      grape_varieties: ['Grenache', 'Mourvèdre', 'Syrah'],
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
      my_tags: ['powerful', 'age-worthy', 'southern-rhône'],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.grape_varieties).toEqual(['Grenache', 'Mourvèdre', 'Syrah'])
    expect(fetched!.my_tags).toEqual(['powerful', 'age-worthy', 'southern-rhône'])
  })

  it('preserves null optional fields', async () => {
    const wine = await adapter.createWine({
      producer: null,
      vintage: null,
      region: null,
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
    expect(fetched!.wishlist_notes).toBeNull()
    expect(fetched!.price_paid).toBeNull()
    expect(fetched!.purchased_from).toBeNull()
    expect(fetched!.quality_classification).toBeNull()
    expect(fetched!.vineyard).toBeNull()
    expect(fetched!.date_first_consumed).toBeNull()
  })

  it('preserves tag booleans through serialization', async () => {
    const wine = await adapter.createWine({
      producer: 'Roumier',
      vintage: 2018,
      region: 'Burgundy',
      denomination: 'Chambolle-Musigny',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: true,
      tag_cellar: true,
      tag_consumed: false,
      cellar_quantity: 3,
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

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.tag_discovered).toBe(true)
    expect(fetched!.tag_wishlist).toBe(true)
    expect(fetched!.tag_cellar).toBe(true)
    expect(fetched!.tag_consumed).toBe(false)
    expect(fetched!.cellar_quantity).toBe(3)
    expect(typeof fetched!.cellar_quantity).toBe('number')
  })

  it('preserves expert_reviews as a JSON round-trip', async () => {
    const wine = await adapter.createWine({
      producer: 'Rousseau',
      vintage: 2019,
      region: 'Burgundy',
      denomination: 'Gevrey-Chambertin',
      grape_varieties: ['Pinot Noir'],
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

    const reviews = [
      {
        source: 'Burghound',
        score: 93,
        tasting_note: 'Impressive depth and concentration.',
        drinking_window: { start: '2027-01-01', end: '2040-12-31' },
        fetched_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    const updated = await adapter.updateWine(wine.id, { expert_reviews: reviews })
    expect(updated.expert_reviews).toEqual(reviews)

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.expert_reviews).toEqual(reviews)
    expect(fetched!.expert_reviews![0].source).toBe('Burghound')
    expect(fetched!.expert_reviews![0].score).toBe(93)
  })

  it('preserves price_data as a JSON round-trip', async () => {
    const wine = await adapter.createWine({
      producer: 'Giacomo Conterno',
      vintage: 2016,
      region: 'Piedmont',
      denomination: 'Barolo',
      grape_varieties: ['Nebbiolo'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: true,
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

    const priceData = {
      min_price: 95,
      avg_price: 112,
      max_price: 140,
      retailers: [
        {
          name: 'K&L Wine Merchants',
          price: 95,
          url: null,
          location: 'New York, NY',
          shipping_policy: 'Ships to most states',
        },
      ],
      fetched_at: '2026-01-01T00:00:00.000Z',
    }
    await adapter.updateWine(wine.id, { price_data: priceData })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.price_data).toEqual(priceData)
    expect(fetched!.price_data!.retailers).toHaveLength(1)
    expect(fetched!.price_data!.min_price).toBe(95)
  })

  it('preserves community data as JSON round-trips', async () => {
    const wine = await adapter.createWine({
      producer: 'Jean-Louis Chave',
      vintage: 2017,
      region: 'Northern Rhône',
      denomination: 'Hermitage',
      grape_varieties: ['Syrah'],
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

    const excerpts = ['Stunning 2017. Hold until 2030+.', 'Opened young — big mistake.']
    await adapter.updateWine(wine.id, {
      community_sentiment: 'Consensus is to hold for at least 10 years. Exceptional potential.',
      community_excerpts: excerpts,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.community_sentiment).toBe(
      'Consensus is to hold for at least 10 years. Exceptional potential.'
    )
    expect(fetched!.community_excerpts).toEqual(excerpts)
  })

  it('preserves wishlist_notes, price_paid, and purchased_from', async () => {
    const wine = await adapter.createWine({
      producer: 'Guigal',
      vintage: 2018,
      region: 'Northern Rhône',
      denomination: 'Côte-Rôtie',
      grape_varieties: ['Syrah'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: true,
      tag_cellar: false,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: null,
      drinking_window: null,
      vintage_rating: 'good',
      my_rating: null,
      my_tags: [],
      wishlist_notes: 'Seen at Chambers St — $85. Buy 3 if available.',
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.wishlist_notes).toBe('Seen at Chambers St — $85. Buy 3 if available.')
    expect(fetched!.price_paid).toBeNull()
    expect(fetched!.purchased_from).toBeNull()

    const updated = await adapter.updateWine(wine.id, {
      tag_cellar: true,
      price_paid: 85.0,
      purchased_from: 'Chambers Street Wines',
      wishlist_notes: null,
    })
    expect(updated.price_paid).toBe(85.0)
    expect(updated.purchased_from).toBe('Chambers Street Wines')
    expect(updated.wishlist_notes).toBeNull()

    const refetched = await adapter.getWine(wine.id)
    expect(refetched!.price_paid).toBe(85.0)
    expect(refetched!.purchased_from).toBe('Chambers Street Wines')
    expect(typeof refetched!.price_paid).toBe('number')
  })

  it('preserves drinking window date range', async () => {
    const wine = await adapter.createWine({
      producer: 'DRC',
      vintage: 2015,
      region: 'Burgundy',
      denomination: 'Échézeaux',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: true,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: 'long_term',
      drinking_window: { start: '2025-01-01', end: '2045-12-31' },
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

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.drinking_window).toEqual({ start: '2025-01-01', end: '2045-12-31' })
  })

  it('preserves numeric fields (vintage, cellar_quantity, price_paid)', async () => {
    const wine = await adapter.createWine({
      producer: 'Bartolo Mascarello',
      vintage: 2013,
      region: 'Piedmont',
      denomination: 'Barolo',
      grape_varieties: ['Nebbiolo'],
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: true,
      tag_consumed: false,
      cellar_quantity: 12,
      cellar_category: 'long_term',
      drinking_window: null,
      vintage_rating: null,
      my_rating: null,
      my_tags: [],
      wishlist_notes: null,
      price_paid: 189.99,
      purchased_from: 'Flatiron Wines',
      date_first_consumed: null,
      quality_classification: null,
      vineyard: null,
      cuvee: null,
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
