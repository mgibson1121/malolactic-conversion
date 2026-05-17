import { randomUUID } from 'crypto'
import type {
  AdviceCategory,
  AdviceEntry,
  AdviceFilter,
  CellarEntry,
  CellarCategory,
  CreateAdviceInput,
  CreateTastingNoteInput,
  CreateWineInput,
  DrinkingWindow,
  ExpertReview,
  MyRating,
  PriceData,
  TastingNote,
  UpdateWineInput,
  UpsertCellarInput,
  UpsertWishlistInput,
  VintageRating,
  WineEntry,
  WineFilter,
  WineStatus,
  WishlistEntry,
  AdviceSourceRole,
  TastingAcidity,
  TastingBody,
  TastingClarity,
  TastingColourIntensity,
  TastingFinish,
  TastingIntensity,
  TastingNoseCondition,
  TastingQuality,
  TastingSweetness,
  TastingTannin,
} from '@shared/types'
import { STATUS_ORDER } from '@shared/types'
import type { StorageAdapter } from '../modules/storage/interface'
import {
  ADVICE_COLS,
  ADVICE_HEADERS,
  CELLAR_COLS,
  CELLAR_HEADERS,
  SHEET_COL_RANGE,
  SHEET_NAMES,
  TASTING_NOTE_COLS,
  TASTING_NOTE_HEADERS,
  WINE_COLS,
  WINE_HEADERS,
  WISHLIST_COLS,
  WISHLIST_HEADERS,
} from './columns'

// ─── Minimal Sheets client interface (enables dependency injection for tests) ──

export interface SheetsClientInterface {
  spreadsheets: {
    values: {
      get(params: {
        spreadsheetId: string
        range: string
      }): Promise<{ data: { values?: string[][] | null } }>
      append(params: {
        spreadsheetId: string
        range: string
        valueInputOption: string
        requestBody: { values: string[][] }
      }): Promise<{ data: unknown }>
      update(params: {
        spreadsheetId: string
        range: string
        valueInputOption: string
        requestBody: { values: string[][] }
      }): Promise<{ data: unknown }>
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cell(row: string[], index: number): string {
  return row[index] ?? ''
}

function safeParseJSON<T>(value: string, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function orNull<T>(value: string, cast?: (v: string) => T): T | null {
  if (!value) return null
  return cast ? cast(value) : (value as unknown as T)
}

// ─── SheetsAdapter ────────────────────────────────────────────────────────────

export class SheetsAdapter implements StorageAdapter {
  constructor(
    private readonly client: SheetsClientInterface,
    private readonly spreadsheetId: string
  ) {}

  // ── Private sheet helpers ──────────────────────────────────────────────────

  /**
   * Read all data rows from a tab (header row excluded).
   * Returns an empty array when the tab has no data.
   */
  private async readSheet(sheetName: string): Promise<string[][]> {
    const res = await this.client.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A2:${SHEET_COL_RANGE}`,
    })
    return res.data.values ?? []
  }

  private async appendRow(sheetName: string, row: string[]): Promise<void> {
    await this.client.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A:${SHEET_COL_RANGE}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    })
  }

  /**
   * Update a row by its 0-based index in the data array (i.e. excluding the
   * header row). Sheet row number = dataIndex + 2.
   */
  private async updateRow(
    sheetName: string,
    dataIndex: number,
    row: string[]
  ): Promise<void> {
    const sheetRow = dataIndex + 2
    await this.client.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A${sheetRow}:${SHEET_COL_RANGE}${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    })
  }

  private async writeHeaders(sheetName: string, headers: string[]): Promise<void> {
    await this.client.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A1:${SHEET_COL_RANGE}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    })
  }

  private findById(rows: string[][], id: string): number {
    return rows.findIndex((row) => row[0] === id)
  }

  private findByWineId(rows: string[][], wineId: string): number {
    return rows.findIndex((row) => row[1] === wineId)
  }

  // ── WineEntry serialization ────────────────────────────────────────────────

  private wineToRow(w: WineEntry): string[] {
    return [
      w.id,
      w.cuvee ?? '',
      w.producer ?? '',
      w.vintage != null ? String(w.vintage) : '',
      w.region ?? '',
      w.denomination ?? '',
      w.grape_varieties != null ? JSON.stringify(w.grape_varieties) : '',
      w.label_image_url ?? '',
      w.status,
      w.cellar_category ?? '',
      w.drinking_window?.start ?? '',
      w.drinking_window?.end ?? '',
      w.vintage_rating ?? '',
      w.my_rating ?? '',
      JSON.stringify(w.my_tags),
      w.date_added,
      w.date_consumed ?? '',
      w.tasting_note_id ?? '',
      w.expert_reviews != null ? JSON.stringify(w.expert_reviews) : '',
      w.community_sentiment ?? '',
      w.community_excerpts != null ? JSON.stringify(w.community_excerpts) : '',
      w.price_data != null ? JSON.stringify(w.price_data) : '',
      w.wishlist_notes ?? '',
      w.price_paid != null ? String(w.price_paid) : '',
      w.purchased_from ?? '',
      w.advice_linked != null ? JSON.stringify(w.advice_linked) : '',
      w.quality_classification ?? '',
      w.vineyard ?? '',
    ]
  }

  private rowToWine(row: string[]): WineEntry {
    const c = (i: number) => cell(row, i)
    const dwStart = c(WINE_COLS.drinking_window_start)
    const dwEnd = c(WINE_COLS.drinking_window_end)
    const drinkingWindow: DrinkingWindow | null =
      dwStart && dwEnd ? { start: dwStart, end: dwEnd } : null

    return {
      id: c(WINE_COLS.id),
      cuvee: orNull(c(WINE_COLS.cuvee)),
      producer: orNull(c(WINE_COLS.producer)),
      vintage: c(WINE_COLS.vintage) ? parseInt(c(WINE_COLS.vintage), 10) : null,
      region: orNull(c(WINE_COLS.region)),
      denomination: orNull(c(WINE_COLS.denomination)),
      grape_varieties: safeParseJSON<string[] | null>(c(WINE_COLS.grape_varieties), null),
      quality_classification: orNull(c(WINE_COLS.quality_classification)),
      vineyard: orNull(c(WINE_COLS.vineyard)),
      label_image_url: orNull(c(WINE_COLS.label_image_url)),
      status: (c(WINE_COLS.status) || 'discovered') as WineStatus,
      cellar_category: orNull<CellarCategory>(c(WINE_COLS.cellar_category)),
      drinking_window: drinkingWindow,
      vintage_rating: orNull<VintageRating>(c(WINE_COLS.vintage_rating)),
      my_rating: orNull<MyRating>(c(WINE_COLS.my_rating)),
      my_tags: safeParseJSON<string[]>(c(WINE_COLS.my_tags), []),
      tasting_note_id: orNull(c(WINE_COLS.tasting_note_id)),
      expert_reviews: safeParseJSON<ExpertReview[] | null>(c(WINE_COLS.expert_reviews), null),
      community_sentiment: orNull(c(WINE_COLS.community_sentiment)),
      community_excerpts: safeParseJSON<string[] | null>(c(WINE_COLS.community_excerpts), null),
      price_data: safeParseJSON<PriceData | null>(c(WINE_COLS.price_data), null),
      wishlist_notes: orNull(c(WINE_COLS.wishlist_notes)),
      price_paid: c(WINE_COLS.price_paid) ? parseFloat(c(WINE_COLS.price_paid)) : null,
      purchased_from: orNull(c(WINE_COLS.purchased_from)),
      advice_linked: safeParseJSON<string[] | null>(c(WINE_COLS.advice_linked), null),
      date_added: c(WINE_COLS.date_added),
      date_consumed: orNull(c(WINE_COLS.date_consumed)),
    }
  }

  // ── CellarEntry serialization ──────────────────────────────────────────────

  private cellarToRow(e: CellarEntry): string[] {
    return [
      e.id,
      e.wine_id,
      String(e.quantity),
      e.location_notes ?? '',
      e.date_acquired ?? '',
      e.price_paid != null ? String(e.price_paid) : '',
      e.purchased_from ?? '',
    ]
  }

  private rowToCellar(row: string[]): CellarEntry {
    const c = (i: number) => cell(row, i)
    return {
      id: c(CELLAR_COLS.id),
      wine_id: c(CELLAR_COLS.wine_id),
      quantity: parseInt(c(CELLAR_COLS.quantity), 10) || 0,
      location_notes: orNull(c(CELLAR_COLS.location_notes)),
      date_acquired: orNull(c(CELLAR_COLS.date_acquired)),
      price_paid: c(CELLAR_COLS.price_paid) ? parseFloat(c(CELLAR_COLS.price_paid)) : null,
      purchased_from: orNull(c(CELLAR_COLS.purchased_from)),
    }
  }

  // ── WishlistEntry serialization ────────────────────────────────────────────

  private wishlistToRow(e: WishlistEntry): string[] {
    return [
      e.id,
      e.wine_id,
      e.wishlist_notes ?? '',
      e.priority != null ? String(e.priority) : '',
    ]
  }

  private rowToWishlist(row: string[]): WishlistEntry {
    const c = (i: number) => cell(row, i)
    return {
      id: c(WISHLIST_COLS.id),
      wine_id: c(WISHLIST_COLS.wine_id),
      wishlist_notes: orNull(c(WISHLIST_COLS.wishlist_notes)),
      priority: c(WISHLIST_COLS.priority) ? parseInt(c(WISHLIST_COLS.priority), 10) : null,
    }
  }

  // ── TastingNote serialization ──────────────────────────────────────────────

  private tastingNoteToRow(n: TastingNote): string[] {
    return [
      n.id,
      n.wine_id,
      n.tasted_at,
      n.clarity ?? '',
      n.colour_intensity ?? '',
      n.colour ?? '',
      n.nose_condition ?? '',
      n.nose_intensity ?? '',
      JSON.stringify(n.nose_primary_aromas),
      JSON.stringify(n.nose_secondary_aromas),
      JSON.stringify(n.nose_tertiary_aromas),
      n.palate_sweetness ?? '',
      n.palate_acidity ?? '',
      n.palate_tannin ?? '',
      n.palate_body ?? '',
      n.palate_flavour_intensity ?? '',
      n.palate_finish ?? '',
      n.quality_assessment ?? '',
      n.my_rating ?? '',
      n.free_text ?? '',
      JSON.stringify(n.tags),
    ]
  }

  private rowToTastingNote(row: string[]): TastingNote {
    const c = (i: number) => cell(row, i)
    return {
      id: c(TASTING_NOTE_COLS.id),
      wine_id: c(TASTING_NOTE_COLS.wine_id),
      tasted_at: c(TASTING_NOTE_COLS.tasted_at),
      clarity: orNull<TastingClarity>(c(TASTING_NOTE_COLS.clarity)),
      colour_intensity: orNull<TastingColourIntensity>(c(TASTING_NOTE_COLS.colour_intensity)),
      colour: orNull(c(TASTING_NOTE_COLS.colour)),
      nose_condition: orNull<TastingNoseCondition>(c(TASTING_NOTE_COLS.nose_condition)),
      nose_intensity: orNull<TastingIntensity>(c(TASTING_NOTE_COLS.nose_intensity)),
      nose_primary_aromas: safeParseJSON<string[]>(c(TASTING_NOTE_COLS.nose_primary_aromas), []),
      nose_secondary_aromas: safeParseJSON<string[]>(
        c(TASTING_NOTE_COLS.nose_secondary_aromas),
        []
      ),
      nose_tertiary_aromas: safeParseJSON<string[]>(
        c(TASTING_NOTE_COLS.nose_tertiary_aromas),
        []
      ),
      palate_sweetness: orNull<TastingSweetness>(c(TASTING_NOTE_COLS.palate_sweetness)),
      palate_acidity: orNull<TastingAcidity>(c(TASTING_NOTE_COLS.palate_acidity)),
      palate_tannin: orNull<TastingTannin>(c(TASTING_NOTE_COLS.palate_tannin)),
      palate_body: orNull<TastingBody>(c(TASTING_NOTE_COLS.palate_body)),
      palate_flavour_intensity: orNull<TastingIntensity>(
        c(TASTING_NOTE_COLS.palate_flavour_intensity)
      ),
      palate_finish: orNull<TastingFinish>(c(TASTING_NOTE_COLS.palate_finish)),
      quality_assessment: orNull<TastingQuality>(c(TASTING_NOTE_COLS.quality_assessment)),
      my_rating: orNull<MyRating>(c(TASTING_NOTE_COLS.my_rating)),
      free_text: orNull(c(TASTING_NOTE_COLS.free_text)),
      tags: safeParseJSON<string[]>(c(TASTING_NOTE_COLS.tags), []),
    }
  }

  // ── AdviceEntry serialization ──────────────────────────────────────────────

  private adviceToRow(a: AdviceEntry): string[] {
    return [
      a.id,
      a.wine_id ?? '',
      a.source_name,
      a.source_role,
      a.category,
      a.content,
      a.captured_at,
    ]
  }

  private rowToAdvice(row: string[]): AdviceEntry {
    const c = (i: number) => cell(row, i)
    return {
      id: c(ADVICE_COLS.id),
      wine_id: orNull(c(ADVICE_COLS.wine_id)),
      source_name: c(ADVICE_COLS.source_name),
      source_role: c(ADVICE_COLS.source_role) as AdviceSourceRole,
      category: c(ADVICE_COLS.category) as AdviceCategory,
      content: c(ADVICE_COLS.content),
      captured_at: c(ADVICE_COLS.captured_at),
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async setupHeaders(): Promise<void> {
    await Promise.all([
      this.writeHeaders(SHEET_NAMES.wines, WINE_HEADERS),
      this.writeHeaders(SHEET_NAMES.cellar, CELLAR_HEADERS),
      this.writeHeaders(SHEET_NAMES.wishlist, WISHLIST_HEADERS),
      this.writeHeaders(SHEET_NAMES.tastingNotes, TASTING_NOTE_HEADERS),
      this.writeHeaders(SHEET_NAMES.advice, ADVICE_HEADERS),
    ])
  }

  // ── Wines ──────────────────────────────────────────────────────────────────

  async createWine(data: CreateWineInput): Promise<WineEntry> {
    const wine: WineEntry = {
      ...data,
      id: randomUUID(),
      tasting_note_id: null,
      advice_linked: null,
      expert_reviews: null,
      community_sentiment: null,
      community_excerpts: null,
      price_data: null,
      date_added: new Date().toISOString(),
    }
    await this.appendRow(SHEET_NAMES.wines, this.wineToRow(wine))
    return wine
  }

  async getWine(id: string): Promise<WineEntry | null> {
    const rows = await this.readSheet(SHEET_NAMES.wines)
    const row = rows.find((r) => r[0] === id)
    return row ? this.rowToWine(row) : null
  }

  async listWines(filter?: WineFilter): Promise<WineEntry[]> {
    const rows = await this.readSheet(SHEET_NAMES.wines)
    let wines = rows.filter((r) => r[0]).map((r) => this.rowToWine(r))

    if (filter?.status) wines = wines.filter((w) => w.status === filter.status)
    if (filter?.my_rating) wines = wines.filter((w) => w.my_rating === filter.my_rating)
    if (filter?.region) wines = wines.filter((w) => w.region === filter.region)
    if (filter?.has_tasting_note) wines = wines.filter((w) => w.tasting_note_id !== null)

    return wines
  }

  async updateWine(id: string, data: UpdateWineInput): Promise<WineEntry> {
    const rows = await this.readSheet(SHEET_NAMES.wines)
    const index = this.findById(rows, id)
    if (index === -1) throw new Error(`Wine not found: ${id}`)

    const current = this.rowToWine(rows[index])
    const updated: WineEntry = { ...current, ...data }
    await this.updateRow(SHEET_NAMES.wines, index, this.wineToRow(updated))
    return updated
  }

  async promoteWine(id: string, toStatus: WineStatus): Promise<WineEntry> {
    const wine = await this.getWine(id)
    if (!wine) throw new Error(`Wine not found: ${id}`)

    const currentIdx = STATUS_ORDER.indexOf(wine.status)
    const targetIdx = STATUS_ORDER.indexOf(toStatus)

    if (targetIdx <= currentIdx) {
      throw new Error(
        `Cannot move wine from '${wine.status}' to '${toStatus}'. ` +
          `Status must advance forward: ${STATUS_ORDER.join(' → ')}`
      )
    }

    const updates: UpdateWineInput = { status: toStatus }
    if (toStatus === 'consumed') {
      updates.date_consumed = new Date().toISOString()
    }

    return this.updateWine(id, updates)
  }

  // ── Tasting notes ──────────────────────────────────────────────────────────

  async createTastingNote(data: CreateTastingNoteInput): Promise<TastingNote> {
    const note: TastingNote = { ...data, id: randomUUID() }
    await this.appendRow(SHEET_NAMES.tastingNotes, this.tastingNoteToRow(note))
    await this.updateWine(data.wine_id, {
      tasting_note_id: note.id,
      my_tags: data.tags,
    })
    return note
  }

  async getTastingNote(id: string): Promise<TastingNote | null> {
    const rows = await this.readSheet(SHEET_NAMES.tastingNotes)
    const row = rows.find((r) => r[0] === id)
    return row ? this.rowToTastingNote(row) : null
  }

  async listTastingNotesByWine(wineId: string): Promise<TastingNote[]> {
    const rows = await this.readSheet(SHEET_NAMES.tastingNotes)
    return rows.filter((r) => r[1] === wineId).map((r) => this.rowToTastingNote(r))
  }

  // ── Advice ─────────────────────────────────────────────────────────────────

  async createAdvice(data: CreateAdviceInput): Promise<AdviceEntry> {
    const entry: AdviceEntry = { ...data, id: randomUUID() }
    await this.appendRow(SHEET_NAMES.advice, this.adviceToRow(entry))
    if (data.wine_id) {
      const wine = await this.getWine(data.wine_id)
      if (wine) {
        const current = wine.advice_linked ?? []
        await this.updateWine(data.wine_id, { advice_linked: [...current, entry.id] })
      }
    }
    return entry
  }

  async getAdvice(id: string): Promise<AdviceEntry | null> {
    const rows = await this.readSheet(SHEET_NAMES.advice)
    const row = rows.find((r) => r[0] === id)
    return row ? this.rowToAdvice(row) : null
  }

  async listAdvice(filter?: AdviceFilter): Promise<AdviceEntry[]> {
    const rows = await this.readSheet(SHEET_NAMES.advice)
    let entries = rows.filter((r) => r[0]).map((r) => this.rowToAdvice(r))

    if (filter?.category) entries = entries.filter((e) => e.category === filter.category)
    if (filter?.wine_id) entries = entries.filter((e) => e.wine_id === filter.wine_id)

    return entries
  }

  // ── Cellar entries ─────────────────────────────────────────────────────────

  async upsertCellarEntry(wineId: string, data: UpsertCellarInput): Promise<CellarEntry> {
    const rows = await this.readSheet(SHEET_NAMES.cellar)
    const index = this.findByWineId(rows, wineId)

    if (index === -1) {
      const entry: CellarEntry = { ...data, id: randomUUID(), wine_id: wineId }
      await this.appendRow(SHEET_NAMES.cellar, this.cellarToRow(entry))
      return entry
    }

    const current = this.rowToCellar(rows[index])
    const updated: CellarEntry = { ...current, ...data }
    await this.updateRow(SHEET_NAMES.cellar, index, this.cellarToRow(updated))
    return updated
  }

  async getCellarEntry(wineId: string): Promise<CellarEntry | null> {
    const rows = await this.readSheet(SHEET_NAMES.cellar)
    const row = rows.find((r) => r[1] === wineId)
    return row ? this.rowToCellar(row) : null
  }

  async listCellarEntries(): Promise<CellarEntry[]> {
    const rows = await this.readSheet(SHEET_NAMES.cellar)
    return rows.filter((r) => r[0]).map((r) => this.rowToCellar(r))
  }

  // ── Wishlist entries ───────────────────────────────────────────────────────

  async upsertWishlistEntry(wineId: string, data: UpsertWishlistInput): Promise<WishlistEntry> {
    const rows = await this.readSheet(SHEET_NAMES.wishlist)
    const index = this.findByWineId(rows, wineId)

    if (index === -1) {
      const entry: WishlistEntry = { ...data, id: randomUUID(), wine_id: wineId }
      await this.appendRow(SHEET_NAMES.wishlist, this.wishlistToRow(entry))
      return entry
    }

    const current = this.rowToWishlist(rows[index])
    const updated: WishlistEntry = { ...current, ...data }
    await this.updateRow(SHEET_NAMES.wishlist, index, this.wishlistToRow(updated))
    return updated
  }

  async getWishlistEntry(wineId: string): Promise<WishlistEntry | null> {
    const rows = await this.readSheet(SHEET_NAMES.wishlist)
    const row = rows.find((r) => r[1] === wineId)
    return row ? this.rowToWishlist(row) : null
  }

  async listWishlistEntries(): Promise<WishlistEntry[]> {
    const rows = await this.readSheet(SHEET_NAMES.wishlist)
    return rows.filter((r) => r[0]).map((r) => this.rowToWishlist(r))
  }
}
