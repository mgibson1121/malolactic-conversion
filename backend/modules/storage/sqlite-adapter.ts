import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { runMigration } from '../../db/migrate'
import type {
  AdviceEntry,
  AdviceFilter,
  CreateAdviceInput,
  CreateTastingNoteInput,
  CreateWineInput,
  DrinkingWindow,
  TastingNote,
  UpdateWineInput,
  WineEntry,
  WineFilter,
} from '@shared/types'
import type { StorageAdapter } from './interface'

// ─── Serialization helpers ────────────────────────────────────────────────────

function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

function fromJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toBool(value: unknown): number {
  return value ? 1 : 0
}

function fromBool(value: number | null | undefined): boolean {
  return value === 1
}

// ─── Row types (what SQLite returns) ─────────────────────────────────────────

interface WineRow {
  id: string
  producer: string | null
  denomination: string | null
  vintage: number | null
  region: string | null
  quality_classification: string | null
  vineyard: string | null
  cuvee: string | null
  grape_varieties: string | null
  label_image_url: string | null
  tag_discovered: number
  tag_wishlist: number
  tag_cellar: number
  tag_consumed: number
  cellar_category: string | null
  cellar_quantity: number
  drinking_window_start: string | null
  drinking_window_end: string | null
  vintage_rating: string | null
  my_rating: string | null
  my_tags: string | null
  latest_tasting_note_id: string | null
  wishlist_notes: string | null
  price_paid: number | null
  purchased_from: string | null
  advice_linked: string | null
  expert_reviews: string | null
  community_sentiment: string | null
  community_excerpts: string | null
  price_data: string | null
  date_added: string
  date_first_consumed: string | null
}

interface TastingNoteRow {
  id: string
  wine_id: string
  date: string
  wset_appearance_clarity: string | null
  wset_appearance_intensity: string | null
  wset_appearance_colour: string | null
  wset_nose_condition: string | null
  wset_nose_intensity: string | null
  wset_nose_primary_aromas: string | null
  wset_nose_secondary_aromas: string | null
  wset_nose_tertiary_aromas: string | null
  wset_palate_sweetness: string | null
  wset_palate_acidity: string | null
  wset_palate_tannin: string | null
  wset_palate_body: string | null
  wset_palate_flavour_intensity: string | null
  wset_palate_finish: string | null
  wset_conclusion_quality: string | null
  my_rating: string | null
  free_text: string | null
  extracted_tags: string | null
}

interface AdviceRow {
  id: string
  tip: string
  source_role: string | null
  category: string | null
  wine_id: string | null
  date_added: string
  source_name: string | null
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function rowToWine(row: WineRow): WineEntry {
  const drinkingWindow: DrinkingWindow | null =
    row.drinking_window_start && row.drinking_window_end
      ? { start: row.drinking_window_start, end: row.drinking_window_end }
      : null

  return {
    id: row.id,
    producer: row.producer,
    denomination: row.denomination,
    vintage: row.vintage,
    region: row.region,
    quality_classification: row.quality_classification,
    vineyard: row.vineyard,
    cuvee: row.cuvee,
    grape_varieties: fromJson<string[] | null>(row.grape_varieties, null),
    label_image_url: row.label_image_url,
    tag_discovered: fromBool(row.tag_discovered),
    tag_wishlist: fromBool(row.tag_wishlist),
    tag_cellar: fromBool(row.tag_cellar),
    tag_consumed: fromBool(row.tag_consumed),
    cellar_category: (row.cellar_category as WineEntry['cellar_category']) ?? null,
    cellar_quantity: row.cellar_quantity ?? 0,
    drinking_window: drinkingWindow,
    vintage_rating: (row.vintage_rating as WineEntry['vintage_rating']) ?? null,
    my_rating: (row.my_rating as WineEntry['my_rating']) ?? null,
    my_tags: fromJson<string[]>(row.my_tags, []),
    latest_tasting_note_id: row.latest_tasting_note_id,
    wishlist_notes: row.wishlist_notes,
    price_paid: row.price_paid,
    purchased_from: row.purchased_from,
    advice_linked: fromJson<string[] | null>(row.advice_linked, null),
    expert_reviews: fromJson(row.expert_reviews, null),
    community_sentiment: row.community_sentiment,
    community_excerpts: fromJson<string[] | null>(row.community_excerpts, null),
    price_data: fromJson(row.price_data, null),
    date_added: row.date_added,
    date_first_consumed: row.date_first_consumed,
  }
}

function rowToTastingNote(row: TastingNoteRow): TastingNote {
  return {
    id: row.id,
    wine_id: row.wine_id,
    tasted_at: row.date,
    clarity: (row.wset_appearance_clarity as TastingNote['clarity']) ?? null,
    colour_intensity: (row.wset_appearance_intensity as TastingNote['colour_intensity']) ?? null,
    colour: row.wset_appearance_colour,
    nose_condition: (row.wset_nose_condition as TastingNote['nose_condition']) ?? null,
    nose_intensity: (row.wset_nose_intensity as TastingNote['nose_intensity']) ?? null,
    nose_primary_aromas: fromJson<string[]>(row.wset_nose_primary_aromas, []),
    nose_secondary_aromas: fromJson<string[]>(row.wset_nose_secondary_aromas, []),
    nose_tertiary_aromas: fromJson<string[]>(row.wset_nose_tertiary_aromas, []),
    palate_sweetness: (row.wset_palate_sweetness as TastingNote['palate_sweetness']) ?? null,
    palate_acidity: (row.wset_palate_acidity as TastingNote['palate_acidity']) ?? null,
    palate_tannin: (row.wset_palate_tannin as TastingNote['palate_tannin']) ?? null,
    palate_body: (row.wset_palate_body as TastingNote['palate_body']) ?? null,
    palate_flavour_intensity: (row.wset_palate_flavour_intensity as TastingNote['palate_flavour_intensity']) ?? null,
    palate_finish: (row.wset_palate_finish as TastingNote['palate_finish']) ?? null,
    quality_assessment: (row.wset_conclusion_quality as TastingNote['quality_assessment']) ?? null,
    my_rating: (row.my_rating as TastingNote['my_rating']) ?? null,
    free_text: row.free_text,
    tags: fromJson<string[]>(row.extracted_tags, []),
  }
}

function rowToAdvice(row: AdviceRow): AdviceEntry {
  return {
    id: row.id,
    wine_id: row.wine_id,
    source_name: row.source_name ?? '',
    source_role: (row.source_role as AdviceEntry['source_role']) ?? 'other',
    category: (row.category as AdviceEntry['category']) ?? 'other',
    content: row.tip,
    captured_at: row.date_added,
  }
}

// ─── SQLiteAdapter ────────────────────────────────────────────────────────────

export class SQLiteAdapter implements StorageAdapter {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
    runMigration(this.db)
  }

  async setupHeaders(): Promise<void> {
    // No-op for SQLite — migration runs in constructor.
  }

  // ── Wines ──────────────────────────────────────────────────────────────────

  async createWine(data: CreateWineInput): Promise<WineEntry> {
    const wine: WineEntry = {
      ...data,
      id: randomUUID(),
      tag_discovered: data.tag_discovered ?? true,
      cellar_quantity: data.cellar_quantity ?? 0,
      latest_tasting_note_id: null,
      advice_linked: null,
      expert_reviews: null,
      community_sentiment: null,
      community_excerpts: null,
      price_data: null,
      date_added: new Date().toISOString(),
    }

    this.db.prepare(`
      INSERT INTO wines (
        id, producer, denomination, vintage, region,
        quality_classification, vineyard, cuvee, grape_varieties, label_image_url,
        tag_discovered, tag_wishlist, tag_cellar, tag_consumed,
        cellar_category, cellar_quantity,
        drinking_window_start, drinking_window_end, vintage_rating,
        my_rating, my_tags, latest_tasting_note_id,
        wishlist_notes, price_paid, purchased_from,
        advice_linked, expert_reviews, community_sentiment, community_excerpts, price_data,
        date_added, date_first_consumed
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `).run(
      wine.id, wine.producer, wine.denomination, wine.vintage, wine.region,
      wine.quality_classification, wine.vineyard, wine.cuvee,
      toJson(wine.grape_varieties), wine.label_image_url,
      toBool(wine.tag_discovered), toBool(wine.tag_wishlist),
      toBool(wine.tag_cellar), toBool(wine.tag_consumed),
      wine.cellar_category, wine.cellar_quantity,
      wine.drinking_window?.start ?? null, wine.drinking_window?.end ?? null,
      wine.vintage_rating,
      wine.my_rating, toJson(wine.my_tags), wine.latest_tasting_note_id,
      wine.wishlist_notes, wine.price_paid, wine.purchased_from,
      toJson(wine.advice_linked), toJson(wine.expert_reviews),
      wine.community_sentiment, toJson(wine.community_excerpts), toJson(wine.price_data),
      wine.date_added, wine.date_first_consumed
    )

    return wine
  }

  async getWine(id: string): Promise<WineEntry | null> {
    const row = this.db.prepare('SELECT * FROM wines WHERE id = ?').get(id) as WineRow | undefined
    return row ? rowToWine(row) : null
  }

  async listWines(filter?: WineFilter): Promise<WineEntry[]> {
    const clauses: string[] = []
    const params: unknown[] = []

    if (filter?.tag_discovered !== undefined) {
      clauses.push('tag_discovered = ?')
      params.push(toBool(filter.tag_discovered))
    }
    if (filter?.tag_wishlist !== undefined) {
      clauses.push('tag_wishlist = ?')
      params.push(toBool(filter.tag_wishlist))
    }
    if (filter?.tag_cellar !== undefined) {
      clauses.push('tag_cellar = ?')
      params.push(toBool(filter.tag_cellar))
    }
    if (filter?.tag_consumed !== undefined) {
      clauses.push('tag_consumed = ?')
      params.push(toBool(filter.tag_consumed))
    }
    if (filter?.has_tasting_note) {
      clauses.push('latest_tasting_note_id IS NOT NULL')
    }
    if (filter?.my_rating) {
      clauses.push('my_rating = ?')
      params.push(filter.my_rating)
    }
    if (filter?.region) {
      clauses.push('region = ?')
      params.push(filter.region)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.prepare(`SELECT * FROM wines ${where}`).all(...params) as WineRow[]
    return rows.map(rowToWine)
  }

  async updateWine(id: string, data: UpdateWineInput): Promise<WineEntry> {
    const existing = await this.getWine(id)
    if (!existing) throw new Error(`Wine not found: ${id}`)

    const updated: WineEntry = { ...existing, ...data }

    this.db.prepare(`
      UPDATE wines SET
        producer = ?, denomination = ?, vintage = ?, region = ?,
        quality_classification = ?, vineyard = ?, cuvee = ?,
        grape_varieties = ?, label_image_url = ?,
        tag_discovered = ?, tag_wishlist = ?, tag_cellar = ?, tag_consumed = ?,
        cellar_category = ?, cellar_quantity = ?,
        drinking_window_start = ?, drinking_window_end = ?,
        vintage_rating = ?, my_rating = ?, my_tags = ?,
        latest_tasting_note_id = ?,
        wishlist_notes = ?, price_paid = ?, purchased_from = ?,
        advice_linked = ?, expert_reviews = ?,
        community_sentiment = ?, community_excerpts = ?, price_data = ?,
        date_first_consumed = ?
      WHERE id = ?
    `).run(
      updated.producer, updated.denomination, updated.vintage, updated.region,
      updated.quality_classification, updated.vineyard, updated.cuvee,
      toJson(updated.grape_varieties), updated.label_image_url,
      toBool(updated.tag_discovered), toBool(updated.tag_wishlist),
      toBool(updated.tag_cellar), toBool(updated.tag_consumed),
      updated.cellar_category, updated.cellar_quantity,
      updated.drinking_window?.start ?? null, updated.drinking_window?.end ?? null,
      updated.vintage_rating, updated.my_rating, toJson(updated.my_tags),
      updated.latest_tasting_note_id,
      updated.wishlist_notes, updated.price_paid, updated.purchased_from,
      toJson(updated.advice_linked), toJson(updated.expert_reviews),
      updated.community_sentiment, toJson(updated.community_excerpts), toJson(updated.price_data),
      updated.date_first_consumed,
      id
    )

    return updated
  }

  // ── Tasting notes ──────────────────────────────────────────────────────────

  async createTastingNote(data: CreateTastingNoteInput): Promise<TastingNote> {
    const note: TastingNote = { ...data, id: randomUUID() }

    this.db.prepare(`
      INSERT INTO tasting_notes (
        id, wine_id, date,
        wset_appearance_clarity, wset_appearance_intensity, wset_appearance_colour,
        wset_nose_condition, wset_nose_intensity,
        wset_nose_primary_aromas, wset_nose_secondary_aromas, wset_nose_tertiary_aromas,
        wset_palate_sweetness, wset_palate_acidity, wset_palate_tannin,
        wset_palate_body, wset_palate_flavour_intensity, wset_palate_finish,
        wset_conclusion_quality, my_rating, free_text, extracted_tags
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )
    `).run(
      note.id, note.wine_id, note.tasted_at,
      note.clarity, note.colour_intensity, note.colour,
      note.nose_condition, note.nose_intensity,
      toJson(note.nose_primary_aromas), toJson(note.nose_secondary_aromas), toJson(note.nose_tertiary_aromas),
      note.palate_sweetness, note.palate_acidity, note.palate_tannin,
      note.palate_body, note.palate_flavour_intensity, note.palate_finish,
      note.quality_assessment, note.my_rating, note.free_text,
      toJson(note.tags)
    )

    const wine = await this.getWine(data.wine_id)
    if (!wine) throw new Error(`Wine not found: ${data.wine_id}`)

    const wineUpdates: UpdateWineInput = {
      latest_tasting_note_id: note.id,
      my_tags: data.tags,
      my_rating: data.my_rating,
      tag_consumed: true,
    }
    if (!wine.tag_consumed) {
      wineUpdates.date_first_consumed = new Date().toISOString()
    }

    await this.updateWine(data.wine_id, wineUpdates)
    return note
  }

  async getTastingNote(id: string): Promise<TastingNote | null> {
    const row = this.db.prepare('SELECT * FROM tasting_notes WHERE id = ?').get(id) as TastingNoteRow | undefined
    return row ? rowToTastingNote(row) : null
  }

  async listTastingNotesByWine(wineId: string): Promise<TastingNote[]> {
    const rows = this.db
      .prepare('SELECT * FROM tasting_notes WHERE wine_id = ? ORDER BY date DESC')
      .all(wineId) as TastingNoteRow[]
    return rows.map(rowToTastingNote)
  }

  // ── Advice ─────────────────────────────────────────────────────────────────

  async createAdvice(data: CreateAdviceInput): Promise<AdviceEntry> {
    const entry: AdviceEntry = { ...data, id: randomUUID() }

    this.db.prepare(`
      INSERT INTO advice (id, tip, source_role, category, wine_id, date_added, source_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.content, entry.source_role, entry.category,
      entry.wine_id, entry.captured_at, entry.source_name
    )

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
    const row = this.db.prepare('SELECT * FROM advice WHERE id = ?').get(id) as AdviceRow | undefined
    return row ? rowToAdvice(row) : null
  }

  async listAdvice(filter?: AdviceFilter): Promise<AdviceEntry[]> {
    const clauses: string[] = []
    const params: unknown[] = []

    if (filter?.category) {
      clauses.push('category = ?')
      params.push(filter.category)
    }
    if (filter?.wine_id) {
      clauses.push('wine_id = ?')
      params.push(filter.wine_id)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.prepare(`SELECT * FROM advice ${where}`).all(...params) as AdviceRow[]
    return rows.map(rowToAdvice)
  }
}
