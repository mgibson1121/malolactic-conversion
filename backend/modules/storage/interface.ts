import type {
  AdviceEntry,
  AdviceFilter,
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

  // ── Tasting notes ──────────────────────────────────────────────────────────

  createTastingNote(data: CreateTastingNoteInput): Promise<TastingNote>
  getTastingNote(id: string): Promise<TastingNote | null>
  listTastingNotesByWine(wineId: string): Promise<TastingNote[]>

  // ── Advice ─────────────────────────────────────────────────────────────────

  createAdvice(data: CreateAdviceInput): Promise<AdviceEntry>
  getAdvice(id: string): Promise<AdviceEntry | null>
  listAdvice(filter?: AdviceFilter): Promise<AdviceEntry[]>

  // ── Setup ──────────────────────────────────────────────────────────────────

  /** Write header rows to all tabs if they are empty. Idempotent. */
  setupHeaders(): Promise<void>
}
