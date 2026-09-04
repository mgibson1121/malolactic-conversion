import type {
  AdviceEntry,
  AdviceFilter,
  AppSettings,
  CreateAdviceInput,
  CreateTastingNoteInput,
  CreateWineInput,
  TastingNote,
  UpdateWineInput,
  WineEntry,
  WineFilter,
} from '@shared/types'

/**
 * Unified storage interface. Both the Google Sheets adapter (Phases 1–4) and the
 * SQLite adapter (Phase 5) implement this contract — routes never depend on the
 * underlying implementation.
 */
export interface StorageAdapter {
  // ── Wines ──────────────────────────────────────────────────────────────────

  createWine(data: CreateWineInput): Promise<WineEntry>
  getWine(id: string): Promise<WineEntry | null>
  listWines(filter?: WineFilter): Promise<WineEntry[]>
  updateWine(id: string, data: UpdateWineInput): Promise<WineEntry>
  /** Phase 9.4 (WI-7). Caller is responsible for checking preconditions
   * (e.g. no tasting notes) before calling — the adapter deletes
   * unconditionally. */
  deleteWine(id: string): Promise<void>
  /** Phase 9.4 (WI-7). Drafts (promoted_at IS NULL) with date_added older
   * than the cutoff. Returns the number deleted. */
  sweepStaleDrafts(olderThan: Date): Promise<number>

  // ── Tasting notes ──────────────────────────────────────────────────────────

  createTastingNote(data: CreateTastingNoteInput): Promise<TastingNote>
  getTastingNote(id: string): Promise<TastingNote | null>
  listTastingNotesByWine(wineId: string): Promise<TastingNote[]>

  // ── Advice ─────────────────────────────────────────────────────────────────

  createAdvice(data: CreateAdviceInput): Promise<AdviceEntry>
  getAdvice(id: string): Promise<AdviceEntry | null>
  listAdvice(filter?: AdviceFilter): Promise<AdviceEntry[]>

  // ── Settings ───────────────────────────────────────────────────────────────

  /** Phase 10.5. Single app-level settings row — not per-wine. */
  getSettings(): Promise<AppSettings>
  updateSettings(data: Partial<AppSettings>): Promise<AppSettings>

  // ── Setup ──────────────────────────────────────────────────────────────────

  /** Write header rows to all tabs if they are empty. Idempotent. */
  setupHeaders(): Promise<void>
}
