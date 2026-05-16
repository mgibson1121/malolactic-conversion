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
    cellar: [],
    wishlist: [],
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
      name: 'Gevrey-Chambertin',
      producer: null,
      vintage: 2018,
      region: 'Burgundy',
      denomination: 'Gevrey-Chambertin',
      grape_varieties: ['Pinot Noir'],
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
    expect(wine.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(wine.date_added).toBeTruthy()
    expect(new Date(wine.date_added).getTime()).not.toBeNaN()
  })

  it('preserves all optional fields', async () => {
    const wine = await adapter.createWine({
      name: 'Volnay 1er Cru Caillerets',
      producer: "Domaine de la Pousse d'Or",
      vintage: 2019,
      region: 'Burgundy',
      denomination: 'Volnay',
      grape_varieties: ['Pinot Noir'],
      label_image_url: 'https://example.com/label.jpg',
      status: 'cellar',
      cellar_category: 'long_term',
      drinking_window: { start: '2027-01-01', end: '2035-12-31' },
      vintage_rating: 'very_good',
      my_rating: 'great',
      my_tags: ['silky', 'floral'],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
      quality_classification: null,
      vineyard: null,
    })

    expect(wine.producer).toBe("Domaine de la Pousse d'Or")
    expect(wine.vintage).toBe(2019)
    expect(wine.region).toBe('Burgundy')
    expect(wine.denomination).toBe('Volnay')
    expect(wine.grape_varieties).toEqual(['Pinot Noir'])
    expect(wine.label_image_url).toBe('https://example.com/label.jpg')
    expect(wine.status).toBe('cellar')
    expect(wine.cellar_category).toBe('long_term')
    expect(wine.drinking_window).toEqual({ start: '2027-01-01', end: '2035-12-31' })
    expect(wine.vintage_rating).toBe('very_good')
    expect(wine.my_rating).toBe('great')
    expect(wine.my_tags).toEqual(['silky', 'floral'])
  })

  it('handles NV wines (null vintage)', async () => {
    const wine = await adapter.createWine({
      name: 'Bollinger Special Cuvée',
      producer: 'Bollinger',
      vintage: null,
      region: 'Champagne',
      denomination: null,
      grape_varieties: ['Pinot Noir', 'Chardonnay', 'Pinot Meunier'],
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
    expect(wine.vintage).toBeNull()
  })
})

describe('getWine', () => {
  it('returns the wine after creation', async () => {
    const created = await adapter.createWine({
      name: 'Barolo',
      producer: 'Giacomo Conterno',
      vintage: 2016,
      region: 'Piedmont',
      denomination: 'Barolo',
      grape_varieties: ['Nebbiolo'],
      label_image_url: null,
      status: 'discovered',
      cellar_category: null,
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

    const fetched = await adapter.getWine(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.name).toBe('Barolo')
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
      name: 'Muscadet',
      producer: null,
      vintage: 2022,
      region: 'Loire',
      denomination: 'Muscadet',
      grape_varieties: ['Melon de Bourgogne'],
      label_image_url: null,
      status: 'discovered',
      cellar_category: null,
      drinking_window: null,
      vintage_rating: null,
      my_rating: 'ok',
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
      quality_classification: null,
      vineyard: null,
    })
    await adapter.createWine({
      name: 'Chablis Grand Cru',
      producer: 'Raveneau',
      vintage: 2020,
      region: 'Burgundy',
      denomination: 'Chablis',
      grape_varieties: ['Chardonnay'],
      label_image_url: null,
      status: 'wishlist',
      cellar_category: null,
      drinking_window: null,
      vintage_rating: 'good',
      my_rating: null,
      my_tags: ['minerally'],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
      quality_classification: null,
      vineyard: null,
    })
  })

  it('returns all wines without a filter', async () => {
    const wines = await adapter.listWines()
    expect(wines).toHaveLength(2)
  })

  it('filters by status', async () => {
    const discovered = await adapter.listWines({ status: 'discovered' })
    expect(discovered).toHaveLength(1)
    expect(discovered[0].name).toBe('Muscadet')

    const wishlist = await adapter.listWines({ status: 'wishlist' })
    expect(wishlist).toHaveLength(1)
    expect(wishlist[0].name).toBe('Chablis Grand Cru')
  })

  it('filters by my_rating', async () => {
    const okWines = await adapter.listWines({ my_rating: 'ok' })
    expect(okWines).toHaveLength(1)
    expect(okWines[0].name).toBe('Muscadet')
  })

  it('filters by region', async () => {
    const burgundy = await adapter.listWines({ region: 'Burgundy' })
    expect(burgundy).toHaveLength(1)
    expect(burgundy[0].name).toBe('Chablis Grand Cru')
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
    expect(withNotes[0].tasting_note_id).not.toBeNull()
  })
})

describe('updateWine', () => {
  it('updates specified fields without changing others', async () => {
    const wine = await adapter.createWine({
      name: 'Rioja Reserva',
      producer: 'CVNE',
      vintage: 2017,
      region: 'Rioja',
      denomination: null,
      grape_varieties: ['Tempranillo'],
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

    const updated = await adapter.updateWine(wine.id, {
      my_rating: 'good',
      my_tags: ['earthy', 'tobacco'],
    })

    expect(updated.my_rating).toBe('good')
    expect(updated.my_tags).toEqual(['earthy', 'tobacco'])
    expect(updated.name).toBe('Rioja Reserva')
    expect(updated.producer).toBe('CVNE')
  })

  it('throws when the wine does not exist', async () => {
    await expect(
      adapter.updateWine('00000000-0000-0000-0000-000000000000', { my_rating: 'good' })
    ).rejects.toThrow('Wine not found')
  })
})

// ─── Status lifecycle ─────────────────────────────────────────────────────────

describe('promoteWine', () => {
  async function createDiscoveredWine() {
    return adapter.createWine({
      name: 'Pommard',
      producer: 'Comte Armand',
      vintage: 2015,
      region: 'Burgundy',
      denomination: 'Pommard',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      status: 'discovered',
      cellar_category: null,
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
  }

  it('advances discovered → wishlist', async () => {
    const wine = await createDiscoveredWine()
    const promoted = await adapter.promoteWine(wine.id, 'wishlist')
    expect(promoted.status).toBe('wishlist')
  })

  it('advances wishlist → cellar', async () => {
    const wine = await createDiscoveredWine()
    await adapter.promoteWine(wine.id, 'wishlist')
    const promoted = await adapter.promoteWine(wine.id, 'cellar')
    expect(promoted.status).toBe('cellar')
  })

  it('advances cellar → consumed and sets date_consumed', async () => {
    const wine = await createDiscoveredWine()
    await adapter.promoteWine(wine.id, 'wishlist')
    await adapter.promoteWine(wine.id, 'cellar')
    const promoted = await adapter.promoteWine(wine.id, 'consumed')
    expect(promoted.status).toBe('consumed')
    expect(promoted.date_consumed).toBeTruthy()
    expect(new Date(promoted.date_consumed!).getTime()).not.toBeNaN()
  })

  it('can skip steps (discovered → cellar)', async () => {
    const wine = await createDiscoveredWine()
    const promoted = await adapter.promoteWine(wine.id, 'cellar')
    expect(promoted.status).toBe('cellar')
  })

  it('throws when trying to move backward (cellar → wishlist)', async () => {
    const wine = await createDiscoveredWine()
    await adapter.promoteWine(wine.id, 'cellar')
    await expect(adapter.promoteWine(wine.id, 'wishlist')).rejects.toThrow(
      /Cannot move wine/
    )
  })

  it('throws when trying to move to the same status', async () => {
    const wine = await createDiscoveredWine()
    await expect(adapter.promoteWine(wine.id, 'discovered')).rejects.toThrow(
      /Cannot move wine/
    )
  })

  it('throws when the wine does not exist', async () => {
    await expect(
      adapter.promoteWine('00000000-0000-0000-0000-000000000000', 'wishlist')
    ).rejects.toThrow('Wine not found')
  })
})

// ─── Tasting notes ────────────────────────────────────────────────────────────

describe('tasting notes', () => {
  let wineId: string

  beforeEach(async () => {
    const wine = await adapter.createWine({
      name: 'Chambolle-Musigny',
      producer: 'Georges Roumier',
      vintage: 2018,
      region: 'Burgundy',
      denomination: 'Chambolle-Musigny',
      grape_varieties: ['Pinot Noir'],
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
      my_rating: 'great',
      free_text: 'Silky and complex. Needs time.',
      tags: ['burgundy', 'pinot-noir', 'great-vintage'],
    })

    expect(note.id).toBeTruthy()
    expect(note.wine_id).toBe(wineId)
    expect(note.clarity).toBe('clear')
    expect(note.nose_primary_aromas).toEqual(['cherry', 'raspberry'])
    expect(note.nose_tertiary_aromas).toEqual(['forest floor', 'mushroom'])
    expect(note.tags).toEqual(['burgundy', 'pinot-noir', 'great-vintage'])
    expect(note.my_rating).toBe('great')
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
      my_rating: 'great',
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

  it('sets tasting_note_id on the parent wine after creation', async () => {
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
    expect(wine!.tasting_note_id).toBe(note.id)
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
      name: 'Other Wine',
      producer: null,
      vintage: 2020,
      region: 'Loire',
      denomination: null,
      grape_varieties: [],
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
      name: 'Meursault',
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
      name: 'Puligny-Montrachet',
      producer: 'Leflaive',
      vintage: 2020,
      region: 'Burgundy',
      denomination: 'Puligny-Montrachet',
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

// ─── Cellar entries ───────────────────────────────────────────────────────────

describe('cellar entries', () => {
  let wineId: string

  beforeEach(async () => {
    const wine = await adapter.createWine({
      name: 'Nuits-Saint-Georges',
      producer: 'Domaine Forey',
      vintage: 2017,
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
    wineId = wine.id
  })

  it('creates a cellar entry', async () => {
    const entry = await adapter.upsertCellarEntry(wineId, {
      quantity: 6,
      location_notes: 'Bottom rack, left',
      date_acquired: '2024-03-15',
      price_paid: 45.0,
      purchased_from: 'Astor Wines',
    })

    expect(entry.id).toBeTruthy()
    expect(entry.wine_id).toBe(wineId)
    expect(entry.quantity).toBe(6)
    expect(entry.location_notes).toBe('Bottom rack, left')
    expect(entry.price_paid).toBe(45.0)
    expect(entry.purchased_from).toBe('Astor Wines')
  })

  it('updates an existing cellar entry (upsert)', async () => {
    await adapter.upsertCellarEntry(wineId, {
      quantity: 6,
      location_notes: null,
      date_acquired: null,
      price_paid: null,
      purchased_from: null,
    })

    const updated = await adapter.upsertCellarEntry(wineId, {
      quantity: 5, // consumed one bottle
      location_notes: 'Middle rack',
      date_acquired: null,
      price_paid: null,
      purchased_from: null,
    })

    expect(updated.quantity).toBe(5)
    expect(updated.location_notes).toBe('Middle rack')

    const entries = await adapter.listCellarEntries()
    expect(entries).toHaveLength(1) // still only one entry for this wine
  })

  it('retrieves a cellar entry by wine id', async () => {
    await adapter.upsertCellarEntry(wineId, {
      quantity: 3,
      location_notes: null,
      date_acquired: '2024-01-10',
      price_paid: 50.0,
      purchased_from: 'Wine.com',
    })

    const entry = await adapter.getCellarEntry(wineId)
    expect(entry).not.toBeNull()
    expect(entry!.quantity).toBe(3)
  })

  it('returns null when no cellar entry exists for the wine', async () => {
    const result = await adapter.getCellarEntry('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('lists all cellar entries', async () => {
    const wine2 = await adapter.createWine({
      name: 'Sancerre',
      producer: 'Henri Bourgeois',
      vintage: 2022,
      region: 'Loire',
      denomination: 'Sancerre',
      grape_varieties: ['Sauvignon Blanc'],
      label_image_url: null,
      status: 'cellar',
      cellar_category: 'table',
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

    await adapter.upsertCellarEntry(wineId, {
      quantity: 6,
      location_notes: null,
      date_acquired: null,
      price_paid: null,
      purchased_from: null,
    })
    await adapter.upsertCellarEntry(wine2.id, {
      quantity: 3,
      location_notes: null,
      date_acquired: null,
      price_paid: null,
      purchased_from: null,
    })

    const entries = await adapter.listCellarEntries()
    expect(entries).toHaveLength(2)
  })
})

// ─── Wishlist entries ─────────────────────────────────────────────────────────

describe('wishlist entries', () => {
  let wineId: string

  beforeEach(async () => {
    const wine = await adapter.createWine({
      name: 'Hermitage',
      producer: 'Jean-Louis Chave',
      vintage: 2019,
      region: 'Northern Rhône',
      denomination: 'Hermitage',
      grape_varieties: ['Syrah'],
      label_image_url: null,
      status: 'wishlist',
      cellar_category: null,
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
    wineId = wine.id
  })

  it('creates a wishlist entry', async () => {
    const entry = await adapter.upsertWishlistEntry(wineId, {
      wishlist_notes: 'Seen at Chambers Street — $220. Buy 2 if available.',
      priority: 1,
    })

    expect(entry.id).toBeTruthy()
    expect(entry.wine_id).toBe(wineId)
    expect(entry.wishlist_notes).toBe('Seen at Chambers Street — $220. Buy 2 if available.')
    expect(entry.priority).toBe(1)
  })

  it('updates an existing wishlist entry (upsert)', async () => {
    await adapter.upsertWishlistEntry(wineId, { wishlist_notes: 'Original note', priority: 2 })
    const updated = await adapter.upsertWishlistEntry(wineId, {
      wishlist_notes: 'Updated note',
      priority: 1,
    })

    expect(updated.wishlist_notes).toBe('Updated note')
    expect(updated.priority).toBe(1)

    const entries = await adapter.listWishlistEntries()
    expect(entries).toHaveLength(1)
  })

  it('retrieves a wishlist entry by wine id', async () => {
    await adapter.upsertWishlistEntry(wineId, { wishlist_notes: 'Must buy', priority: null })
    const entry = await adapter.getWishlistEntry(wineId)
    expect(entry).not.toBeNull()
    expect(entry!.wishlist_notes).toBe('Must buy')
  })

  it('returns null when no wishlist entry exists', async () => {
    const result = await adapter.getWishlistEntry('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })
})

// ─── Serialization round-trips ────────────────────────────────────────────────

describe('serialization round-trips', () => {
  it('preserves arrays through Google Sheets (JSON-encoded cells)', async () => {
    const wine = await adapter.createWine({
      name: 'Châteauneuf-du-Pape',
      producer: 'Château Rayas',
      vintage: 2010,
      region: 'Southern Rhône',
      denomination: 'Châteauneuf-du-Pape',
      grape_varieties: ['Grenache', 'Mourvèdre', 'Syrah'],
      label_image_url: null,
      status: 'discovered',
      cellar_category: null,
      drinking_window: null,
      vintage_rating: null,
      my_rating: null,
      my_tags: ['powerful', 'age-worthy', 'southern-rhône'],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
      quality_classification: null,
      vineyard: null,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.grape_varieties).toEqual(['Grenache', 'Mourvèdre', 'Syrah'])
    expect(fetched!.my_tags).toEqual(['powerful', 'age-worthy', 'southern-rhône'])
  })

  it('preserves null optional fields', async () => {
    const wine = await adapter.createWine({
      name: 'Unknown Red',
      producer: null,
      vintage: null,
      region: null,
      denomination: null,
      grape_varieties: [],
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

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.producer).toBeNull()
    expect(fetched!.vintage).toBeNull()
    expect(fetched!.region).toBeNull()
    expect(fetched!.drinking_window).toBeNull()
    expect(fetched!.my_rating).toBeNull()
    expect(fetched!.tasting_note_id).toBeNull()
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
  })

  it('preserves expert_reviews as a JSON round-trip', async () => {
    const wine = await adapter.createWine({
      name: 'Gevrey-Chambertin',
      producer: 'Rousseau',
      vintage: 2019,
      region: 'Burgundy',
      denomination: 'Gevrey-Chambertin',
      grape_varieties: ['Pinot Noir'],
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
      name: 'Barolo',
      producer: 'Giacomo Conterno',
      vintage: 2016,
      region: 'Piedmont',
      denomination: 'Barolo',
      grape_varieties: ['Nebbiolo'],
      label_image_url: null,
      status: 'wishlist',
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

    const priceData = {
      min_price: 95,
      avg_price: 112,
      max_price: 140,
      retailers: [
        {
          name: 'Chambers Street Wines',
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
      name: 'Hermitage',
      producer: 'Jean-Louis Chave',
      vintage: 2017,
      region: 'Northern Rhône',
      denomination: 'Hermitage',
      grape_varieties: ['Syrah'],
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
      name: 'Côte-Rôtie',
      producer: 'Guigal',
      vintage: 2018,
      region: 'Northern Rhône',
      denomination: 'Côte-Rôtie',
      grape_varieties: ['Syrah'],
      label_image_url: null,
      status: 'wishlist',
      cellar_category: null,
      drinking_window: null,
      vintage_rating: 'good',
      my_rating: null,
      my_tags: [],
      wishlist_notes: 'Seen at Chambers St — $85. Buy 3 if available.',
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
      quality_classification: null,
      vineyard: null,
    })

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.wishlist_notes).toBe('Seen at Chambers St — $85. Buy 3 if available.')
    expect(fetched!.price_paid).toBeNull()
    expect(fetched!.purchased_from).toBeNull()

    const updated = await adapter.updateWine(wine.id, {
      status: 'cellar',
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
      name: 'Échézeaux',
      producer: 'DRC',
      vintage: 2015,
      region: 'Burgundy',
      denomination: 'Échézeaux',
      grape_varieties: ['Pinot Noir'],
      label_image_url: null,
      status: 'cellar',
      cellar_category: 'long_term',
      drinking_window: { start: '2025-01-01', end: '2045-12-31' },
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

    const fetched = await adapter.getWine(wine.id)
    expect(fetched!.drinking_window).toEqual({ start: '2025-01-01', end: '2045-12-31' })
  })

  it('preserves numeric fields (vintage, price_paid, quantity)', async () => {
    const wine = await adapter.createWine({
      name: 'Barolo',
      producer: 'Bartolo Mascarello',
      vintage: 2013,
      region: 'Piedmont',
      denomination: 'Barolo',
      grape_varieties: ['Nebbiolo'],
      label_image_url: null,
      status: 'cellar',
      cellar_category: 'long_term',
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

    const cellarEntry = await adapter.upsertCellarEntry(wine.id, {
      quantity: 12,
      location_notes: null,
      date_acquired: '2023-06-01',
      price_paid: 189.99,
      purchased_from: 'Flatiron Wines',
    })

    const fetched = await adapter.getCellarEntry(wine.id)
    expect(fetched!.quantity).toBe(12)
    expect(fetched!.price_paid).toBe(189.99)
    expect(typeof fetched!.quantity).toBe('number')
    expect(typeof fetched!.price_paid).toBe('number')

    const fetchedWine = await adapter.getWine(wine.id)
    expect(fetchedWine!.vintage).toBe(2013)
    expect(typeof fetchedWine!.vintage).toBe('number')
  })
})
