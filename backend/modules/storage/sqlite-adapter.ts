import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { runMigration } from '../../db/migrate'
import type {
  AdviceEntry,
  AdviceFilter,
  AppSettings,
  CreateAdviceInput,
  CreateTastingNoteInput,
  CreateWineInput,
  DrinkingWindow,
  TastingNote,
  UpdateWineInput,
  WineEntry,
  WineFilter,
} from '@shared/types'
import { buildCriticSummary } from '@shared/utils/critic-summary'
import { buildReviewLadder } from '@shared/utils/review-ladder'
import { buildBottlingPrompt } from '@shared/utils/bottling-prompt'
import { bottlingWineOf, type BottlingWine } from '@shared/utils/bottling-difference'
import { enrichmentStale } from '@shared/utils/enrichment-stale'
import { describePriceExclusions } from '@shared/utils/price-exclusions'
import { windowStatusOf } from '@shared/utils/window-status'
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
  wine_color: string | null
  label_image_url: string | null
  tag_discovered: number
  tag_wishlist: number
  tag_cellar: number
  tag_consumed: number
  cellar_category: string | null
  cellar_quantity: number
  drinking_window_start: string | null
  drinking_window_end: string | null
  drinking_window_source: string | null
  vintage_rating: string | null
  vintage_rating_source: string | null
  my_rating: string | null
  my_tags: string | null
  latest_tasting_note_id: string | null
  wishlist_notes: string | null
  price_paid: number | null
  manual_price: number | null
  bottling_plain: number | null
  bottling_prompt_dismissed: string | null
  purchased_from: string | null
  advice_linked: string | null
  expert_reviews: string | null
  community_sentiment: string | null
  community_excerpts: string | null
  price_data: string | null
  retailer_links: string | null
  review_data: string | null
  review_probe_log: string | null
  date_added: string
  date_first_consumed: string | null
  promoted_at: string | null
  // Not a column — computed by WINE_SELECT's subquery (Phase 12).
  latest_tasting_note_date: string | null
}

interface TastingNoteRow {
  id: string
  wine_id: string | null
  wine_producer: string | null
  wine_denomination: string | null
  wine_vintage: number | null
  wine_vineyard: string | null
  wine_cuvee: string | null
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

interface AppSettingsRow {
  id: number
  cellar_capacity: number | null
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

  const priceData = fromJson<WineEntry['price_data']>(row.price_data, null)
  const reviewData = fromJson<WineEntry['review_data']>(row.review_data, null)

  const bottlingWine: BottlingWine = bottlingWineOf({
    ...row,
    grape_varieties: fromJson<string[] | null>(row.grape_varieties, null),
    bottling_plain: row.bottling_plain == null ? null : row.bottling_plain === 1,
  })
  const reviewLadder = buildReviewLadder(reviewData, bottlingWine)

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
    wine_color: (row.wine_color as WineEntry['wine_color']) ?? null,
    label_image_url: row.label_image_url,
    tag_discovered: fromBool(row.tag_discovered),
    tag_wishlist: fromBool(row.tag_wishlist),
    tag_cellar: fromBool(row.tag_cellar),
    tag_consumed: fromBool(row.tag_consumed),
    cellar_category: (row.cellar_category as WineEntry['cellar_category']) ?? null,
    cellar_quantity: row.cellar_quantity ?? 0,
    drinking_window: drinkingWindow,
    drinking_window_source: (row.drinking_window_source as WineEntry['drinking_window_source']) ?? null,
    vintage_rating: (row.vintage_rating as WineEntry['vintage_rating']) ?? null,
    vintage_rating_source: (row.vintage_rating_source as WineEntry['vintage_rating_source']) ?? null,
    my_rating: (row.my_rating as WineEntry['my_rating']) ?? null,
    my_tags: fromJson<string[]>(row.my_tags, []),
    latest_tasting_note_id: row.latest_tasting_note_id,
    wishlist_notes: row.wishlist_notes,
    price_paid: row.price_paid,
    manual_price: row.manual_price ?? null,
    bottling_plain: row.bottling_plain == null ? null : row.bottling_plain === 1,
    bottling_prompt_dismissed: row.bottling_prompt_dismissed ?? null,
    purchased_from: row.purchased_from,
    advice_linked: fromJson<string[] | null>(row.advice_linked, null),
    expert_reviews: fromJson(row.expert_reviews, null),
    community_sentiment: row.community_sentiment,
    community_excerpts: fromJson<string[] | null>(row.community_excerpts, null),
    price_data: priceData,
    retailer_links: fromJson<Record<string, string> | null>(row.retailer_links, null),
    review_data: reviewData,
    review_probe_log: fromJson(row.review_probe_log, null),
    date_added: row.date_added,
    date_first_consumed: row.date_first_consumed,
    promoted_at: row.promoted_at,
    latest_tasting_note_date: row.latest_tasting_note_date ?? null,
    // Phase 12.1 — derived on every read, never stored, never re-derived by
    // a client (shared/utils/window-status.ts, critic-summary.ts,
    // enrichment-stale.ts).
    window_status: windowStatusOf(drinkingWindow, reviewData),
    critic_summary: buildCriticSummary(reviewData, row.vintage, undefined, bottlingWine),
    enrichment_stale: enrichmentStale({
      producer: row.producer,
      denomination: row.denomination,
      vintage: row.vintage,
      cuvee: row.cuvee,
      vineyard: row.vineyard,
      quality_classification: row.quality_classification,
      price_data: priceData,
      review_data: reviewData,
    }),
    price_exclusions: describePriceExclusions(priceData),
    // Phase 12.2 — the review ladder and the bottling prompt, derived from the
    // stored pages and listings against the wine's current identity.
    review_ladder: reviewLadder,
    bottling_prompt: buildBottlingPrompt({
      wine: bottlingWine,
      price_data: priceData,
      review_data: reviewData,
      review_ladder: reviewLadder,
      bottling_plain: bottlingWine.bottling_plain,
      bottling_prompt_dismissed: row.bottling_prompt_dismissed ?? null,
    }),
  }
}

// Phase 12 — every wine read carries its latest tasting note's date, so the
// iOS Notes tab can sort and label by it without a request per row. A
// correlated subquery rather than a JOIN: tasting_notes shares column names
// with wines (my_rating, id), and listWines' WHERE clauses use bare names.
const WINE_SELECT = `SELECT wines.*,
  (SELECT date FROM tasting_notes WHERE tasting_notes.id = wines.latest_tasting_note_id) AS latest_tasting_note_date
  FROM wines`

function rowToTastingNote(row: TastingNoteRow): TastingNote {
  return {
    id: row.id,
    wine_id: row.wine_id,
    wine_producer: row.wine_producer ?? null,
    wine_denomination: row.wine_denomination ?? null,
    wine_vintage: row.wine_vintage ?? null,
    wine_vineyard: row.wine_vineyard ?? null,
    wine_cuvee: row.wine_cuvee ?? null,
    wine_removed: row.wine_id === null,
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
    // ON DELETE SET NULL on tasting_notes.wine_id (migration 008) only works
    // with enforcement on. better-sqlite3 defaults it on, but a note that
    // outlives its wine is a rule, not a default to lean on.
    this.db.pragma('foreign_keys = ON')
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
      tag_discovered: data.tag_discovered ?? false,
      cellar_quantity: data.cellar_quantity ?? 0,
      drinking_window_source: data.drinking_window ? 'manual' : null,
      vintage_rating_source: data.vintage_rating ? 'manual' : null,
      latest_tasting_note_id: null,
      advice_linked: null,
      expert_reviews: null,
      community_sentiment: null,
      community_excerpts: null,
      price_data: null,
      manual_price: null,
      bottling_plain: null,
      bottling_prompt_dismissed: null,
      retailer_links: null,
      review_data: null,
      review_probe_log: null,
      date_added: new Date().toISOString(),
      // Phase 9.4 — every creation path starts as a draft, unconditionally.
      // Promotion happens only via updateWine (from POST /:id/promote),
      // never at creation — see CLAUDE.md §3.
      promoted_at: null,
    }

    this.db.prepare(`
      INSERT INTO wines (
        id, producer, denomination, vintage, region,
        quality_classification, vineyard, cuvee, grape_varieties, wine_color, label_image_url,
        tag_discovered, tag_wishlist, tag_cellar, tag_consumed,
        cellar_category, cellar_quantity,
        drinking_window_start, drinking_window_end, drinking_window_source,
        vintage_rating, vintage_rating_source,
        my_rating, my_tags, latest_tasting_note_id,
        wishlist_notes, price_paid, manual_price, purchased_from,
        advice_linked, expert_reviews, community_sentiment, community_excerpts, price_data,
        retailer_links, review_data, review_probe_log, date_added, date_first_consumed,
        promoted_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?
      )
    `).run(
      wine.id, wine.producer, wine.denomination, wine.vintage, wine.region,
      wine.quality_classification, wine.vineyard, wine.cuvee,
      toJson(wine.grape_varieties), wine.wine_color, wine.label_image_url,
      toBool(wine.tag_discovered), toBool(wine.tag_wishlist),
      toBool(wine.tag_cellar), toBool(wine.tag_consumed),
      wine.cellar_category, wine.cellar_quantity,
      wine.drinking_window?.start ?? null, wine.drinking_window?.end ?? null, wine.drinking_window_source,
      wine.vintage_rating, wine.vintage_rating_source,
      wine.my_rating, toJson(wine.my_tags), wine.latest_tasting_note_id,
      wine.wishlist_notes, wine.price_paid, wine.manual_price, wine.purchased_from,
      toJson(wine.advice_linked), toJson(wine.expert_reviews),
      wine.community_sentiment, toJson(wine.community_excerpts), toJson(wine.price_data),
      toJson(wine.retailer_links), toJson(wine.review_data), toJson(wine.review_probe_log),
      wine.date_added, wine.date_first_consumed,
      wine.promoted_at
    )

    return wine
  }

  async getWine(id: string): Promise<WineEntry | null> {
    const row = this.db.prepare(`${WINE_SELECT} WHERE id = ?`).get(id) as WineRow | undefined
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
    // Phase 10.5 — plain substring match; a personal-collection data volume
    // doesn't warrant FTS5.
    if (filter?.q) {
      clauses.push('(producer LIKE ? OR denomination LIKE ? OR vineyard LIKE ? OR cuvee LIKE ?)')
      const like = `%${filter.q}%`
      params.push(like, like, like, like)
    }
    // Phase 9.4 — drafts (promoted_at IS NULL) are excluded from every list
    // unless the caller explicitly opts in. Defaulting this way means every
    // pre-9.4 caller stays correct without modification.
    if (!filter?.include_drafts) {
      clauses.push('promoted_at IS NOT NULL')
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.prepare(`${WINE_SELECT} ${where}`).all(...params) as WineRow[]
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
        grape_varieties = ?, wine_color = ?, label_image_url = ?,
        tag_discovered = ?, tag_wishlist = ?, tag_cellar = ?, tag_consumed = ?,
        cellar_category = ?, cellar_quantity = ?,
        drinking_window_start = ?, drinking_window_end = ?, drinking_window_source = ?,
        vintage_rating = ?, vintage_rating_source = ?, my_rating = ?, my_tags = ?,
        latest_tasting_note_id = ?,
        wishlist_notes = ?, price_paid = ?, manual_price = ?, purchased_from = ?,
        advice_linked = ?, expert_reviews = ?,
        community_sentiment = ?, community_excerpts = ?, price_data = ?,
        retailer_links = ?, review_data = ?, review_probe_log = ?, date_first_consumed = ?,
        promoted_at = ?, bottling_plain = ?, bottling_prompt_dismissed = ?
      WHERE id = ?
    `).run(
      updated.producer, updated.denomination, updated.vintage, updated.region,
      updated.quality_classification, updated.vineyard, updated.cuvee,
      toJson(updated.grape_varieties), updated.wine_color, updated.label_image_url,
      toBool(updated.tag_discovered), toBool(updated.tag_wishlist),
      toBool(updated.tag_cellar), toBool(updated.tag_consumed),
      updated.cellar_category, updated.cellar_quantity,
      updated.drinking_window?.start ?? null, updated.drinking_window?.end ?? null, updated.drinking_window_source,
      updated.vintage_rating, updated.vintage_rating_source, updated.my_rating, toJson(updated.my_tags),
      updated.latest_tasting_note_id,
      updated.wishlist_notes, updated.price_paid, updated.manual_price, updated.purchased_from,
      toJson(updated.advice_linked), toJson(updated.expert_reviews),
      updated.community_sentiment, toJson(updated.community_excerpts), toJson(updated.price_data),
      toJson(updated.retailer_links), toJson(updated.review_data), toJson(updated.review_probe_log),
      updated.date_first_consumed,
      updated.promoted_at,
      updated.bottling_plain == null ? null : toBool(updated.bottling_plain),
      updated.bottling_prompt_dismissed ?? null,
      id
    )

    // Re-read rather than returning the merge: latest_tasting_note_date is
    // derived, and a changed latest_tasting_note_id would leave it stale.
    return (await this.getWine(id)) as WineEntry
  }

  // Phase 9.4 (WI-7)
  async deleteWine(id: string): Promise<void> {
    // Tasting notes survive (ON DELETE SET NULL, migration 008) — the wine
    // row goes, its notes stay with wine_id NULL and their identity snapshot.
    // Advice rows also point at the wine; an advice tip is not tied to one
    // bottle, so it is detached rather than blocking the delete.
    const remove = this.db.transaction(() => {
      this.db.prepare('UPDATE advice SET wine_id = NULL WHERE wine_id = ?').run(id)
      this.db.prepare('DELETE FROM wines WHERE id = ?').run(id)
    })
    remove()
  }

  async sweepStaleDrafts(olderThan: Date): Promise<number> {
    const result = this.db
      .prepare('DELETE FROM wines WHERE promoted_at IS NULL AND date_added < ?')
      .run(olderThan.toISOString())
    return result.changes
  }

  // ── Tasting notes ──────────────────────────────────────────────────────────

  async createTastingNote(data: CreateTastingNoteInput): Promise<TastingNote> {
    const wine = await this.getWine(data.wine_id)
    if (!wine) throw new Error(`Wine not found: ${data.wine_id}`)

    // Phase 12.1 (WI-3) — the note keeps its own copy of the wine's identity,
    // so it still reads correctly after the wine is deleted.
    const note: TastingNote = {
      ...data,
      id: randomUUID(),
      wine_producer: wine.producer,
      wine_denomination: wine.denomination,
      wine_vintage: wine.vintage,
      wine_vineyard: wine.vineyard,
      wine_cuvee: wine.cuvee,
      wine_removed: false,
    }

    this.db.prepare(`
      INSERT INTO tasting_notes (
        id, wine_id, date,
        wset_appearance_clarity, wset_appearance_intensity, wset_appearance_colour,
        wset_nose_condition, wset_nose_intensity,
        wset_nose_primary_aromas, wset_nose_secondary_aromas, wset_nose_tertiary_aromas,
        wset_palate_sweetness, wset_palate_acidity, wset_palate_tannin,
        wset_palate_body, wset_palate_flavour_intensity, wset_palate_finish,
        wset_conclusion_quality, my_rating, free_text, extracted_tags,
        wine_producer, wine_denomination, wine_vintage, wine_vineyard, wine_cuvee
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `).run(
      note.id, note.wine_id, note.tasted_at,
      note.clarity, note.colour_intensity, note.colour,
      note.nose_condition, note.nose_intensity,
      toJson(note.nose_primary_aromas), toJson(note.nose_secondary_aromas), toJson(note.nose_tertiary_aromas),
      note.palate_sweetness, note.palate_acidity, note.palate_tannin,
      note.palate_body, note.palate_flavour_intensity, note.palate_finish,
      note.quality_assessment, note.my_rating, note.free_text,
      toJson(note.tags),
      note.wine_producer, note.wine_denomination, note.wine_vintage, note.wine_vineyard, note.wine_cuvee
    )

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

  // Phase 12.1 (WI-3) — every note, newest first, including notes whose wine
  // has been deleted. The Notes list reads this rather than walking
  // wines.latest_tasting_note_id, which a detached note has no wine to carry.
  async listTastingNotes(): Promise<TastingNote[]> {
    const rows = this.db
      .prepare('SELECT * FROM tasting_notes ORDER BY date DESC')
      .all() as TastingNoteRow[]
    return rows.map(rowToTastingNote)
  }

  async listTastingNotesByWine(wineId: string): Promise<TastingNote[]> {
    const rows = this.db
      .prepare('SELECT * FROM tasting_notes WHERE wine_id = ? ORDER BY date DESC')
      .all(wineId) as TastingNoteRow[]
    return rows.map(rowToTastingNote)
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  async getSettings(): Promise<AppSettings> {
    const row = this.db
      .prepare('SELECT * FROM app_settings WHERE id = 1')
      .get() as AppSettingsRow
    return { cellar_capacity: row.cellar_capacity }
  }

  async updateSettings(data: Partial<AppSettings>): Promise<AppSettings> {
    const existing = await this.getSettings()
    const updated: AppSettings = { ...existing, ...data }
    this.db
      .prepare('UPDATE app_settings SET cellar_capacity = ? WHERE id = 1')
      .run(updated.cellar_capacity)
    return updated
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
