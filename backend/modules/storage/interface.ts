import type {
  AdviceEntry,
  AdviceFilter,
  CellarEntry,
  CreateAdviceInput,
  CreateTastingNoteInput,
  CreateWineInput,
  TastingNote,
  UpdateWineInput,
  UpsertCellarInput,
  UpsertWishlistInput,
  WineEntry,
  WineFilter,
  WineStatus,
  WishlistEntry,
} from '@shared/types'

/**
 * Unified storage interface. Both the Google Sheets adapter (Phase 1) and the
 * SQLite adapter (Phase 5) implement this contract — routes never depend on the
 * underlying implementation.
 */
export interface StorageAdapter {
  // ── Wines ──────────────────────────────────────────────────────────────────

  createWine(data: CreateWineInput): Promise<WineEntry>
  getWine(id: string): Promise<WineEntry | null>
  listWines(filter?: WineFilter): Promise<WineEntry[]>
  updateWine(id: string, data: UpdateWineInput): Promise<WineEntry>

  /**
   * Advance a wine's status along the lifecycle:
   *   discovered → wishlist → cellar → consumed
   * Throws if the target status is not strictly ahead of the current one.
   * Sets date_consumed automatically when promoting to 'consumed'.
   */
  promoteWine(id: string, toStatus: WineStatus): Promise<WineEntry>

  // ── Tasting notes ──────────────────────────────────────────────────────────

  createTastingNote(data: CreateTastingNoteInput): Promise<TastingNote>
  getTastingNote(id: string): Promise<TastingNote | null>
  listTastingNotesByWine(wineId: string): Promise<TastingNote[]>

  // ── Advice ─────────────────────────────────────────────────────────────────

  createAdvice(data: CreateAdviceInput): Promise<AdviceEntry>
  getAdvice(id: string): Promise<AdviceEntry | null>
  listAdvice(filter?: AdviceFilter): Promise<AdviceEntry[]>

  // ── Cellar entries (supplementary data for status=cellar wines) ────────────

  upsertCellarEntry(wineId: string, data: UpsertCellarInput): Promise<CellarEntry>
  getCellarEntry(wineId: string): Promise<CellarEntry | null>
  listCellarEntries(): Promise<CellarEntry[]>

  // ── Wishlist entries (supplementary data for status=wishlist wines) ────────

  upsertWishlistEntry(wineId: string, data: UpsertWishlistInput): Promise<WishlistEntry>
  getWishlistEntry(wineId: string): Promise<WishlistEntry | null>
  listWishlistEntries(): Promise<WishlistEntry[]>

  // ── Setup ──────────────────────────────────────────────────────────────────

  /** Write header rows to all tabs if they are empty. Idempotent. */
  setupHeaders(): Promise<void>
}
