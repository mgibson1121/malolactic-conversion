// ─── Enrichment types ─────────────────────────────────────────────────────────

export interface ExpertReview {
  source: string         // e.g. "Burghound", "Vinous"
  score: number | null
  tasting_note: string | null
  drinking_window: DrinkingWindow | null
  fetched_at: string     // ISO timestamp
}

export interface RetailerPrice {
  name: string
  price: number
  url: string | null
  location: string | null
  shipping_policy: string | null
}

export interface PriceData {
  min_price: number | null
  avg_price: number | null
  max_price: number | null
  retailers: RetailerPrice[]
  fetched_at: string     // ISO timestamp
}

// ─── Status lifecycle ─────────────────────────────────────────────────────────

export type WineStatus = 'discovered' | 'wishlist' | 'cellar' | 'consumed'
export const STATUS_ORDER: WineStatus[] = ['discovered', 'wishlist', 'cellar', 'consumed']

// ─── Enum types ───────────────────────────────────────────────────────────────

export type CellarCategory = 'table' | 'near_term' | 'long_term'
export type VintageRating = 'below_avg' | 'avg' | 'good' | 'very_good'
export type MyRating = 'pass' | 'ok' | 'good' | 'great'

export type TastingClarity = 'clear' | 'hazy'
export type TastingColourIntensity = 'pale' | 'medium' | 'deep'
export type TastingNoseCondition = 'clean' | 'unclean'
export type TastingIntensity = 'light' | 'medium' | 'medium_plus' | 'pronounced'
export type TastingSweetness =
  | 'dry'
  | 'off_dry'
  | 'medium_dry'
  | 'medium'
  | 'medium_sweet'
  | 'sweet'
  | 'luscious'
export type TastingAcidity = 'low' | 'medium_minus' | 'medium' | 'medium_plus' | 'high'
export type TastingTannin = 'low' | 'medium_minus' | 'medium' | 'medium_plus' | 'high'
export type TastingBody = 'light' | 'medium' | 'full'
export type TastingFinish = 'short' | 'medium' | 'long'
export type TastingQuality =
  | 'flawed'
  | 'poor'
  | 'acceptable'
  | 'good'
  | 'very_good'
  | 'outstanding'

export type AdviceSourceRole = 'sommelier' | 'friend' | 'merchant' | 'writer' | 'other'
export type AdviceCategory = 'producer' | 'technique' | 'value' | 'region' | 'vintage' | 'other'

// ─── Core entities ────────────────────────────────────────────────────────────

export interface DrinkingWindow {
  start: string // ISO date (YYYY-MM-DD)
  end: string
}

export interface WineEntry {
  id: string
  // Tier 1 — Canonical, expected on every entry
  producer: string | null
  vintage: number | null // null for NV
  region: string | null
  denomination: string | null
  // Tier 2 — LLM-enriched, nullable by design
  quality_classification: string | null
  vineyard: string | null
  cuvee: string | null          // prestige/commercial name; also overflow for unclassified label text
  grape_varieties: string[] | null  // extracted or inferred from denomination; null if ambiguous
  label_image_url: string | null
  status: WineStatus
  cellar_category: CellarCategory | null
  drinking_window: DrinkingWindow | null
  vintage_rating: VintageRating | null
  my_rating: MyRating | null
  my_tags: string[]
  wishlist_notes: string | null
  price_paid: number | null
  purchased_from: string | null
  tasting_note_id: string | null   // FK to tasting_notes; set by createTastingNote, never user-supplied
  advice_linked: string[] | null   // advice UUIDs; appended by createAdvice, never user-supplied
  expert_reviews: ExpertReview[] | null  // null until Phase 6 modules populate
  community_sentiment: string | null     // GPT-4o synthesis; null if no key configured
  community_excerpts: string[] | null    // raw Reddit excerpts; fallback when no LLM key
  price_data: PriceData | null           // null until Phase 6 price module populates
  date_added: string // ISO timestamp
  date_consumed: string | null // ISO timestamp; set when status → consumed
}

// Supplementary cellar data — created when a wine is promoted to status=cellar
export interface CellarEntry {
  id: string
  wine_id: string
  quantity: number
  location_notes: string | null
  date_acquired: string | null // ISO date
  price_paid: number | null
  purchased_from: string | null
}

// Supplementary wishlist data — created when a wine is promoted to status=wishlist
export interface WishlistEntry {
  id: string
  wine_id: string
  wishlist_notes: string | null
  priority: number | null
}

export interface TastingNote {
  id: string
  wine_id: string
  tasted_at: string // ISO timestamp
  // Appearance
  clarity: TastingClarity | null
  colour_intensity: TastingColourIntensity | null
  colour: string | null
  // Nose
  nose_condition: TastingNoseCondition | null
  nose_intensity: TastingIntensity | null
  nose_primary_aromas: string[]
  nose_secondary_aromas: string[]
  nose_tertiary_aromas: string[]
  // Palate
  palate_sweetness: TastingSweetness | null
  palate_acidity: TastingAcidity | null
  palate_tannin: TastingTannin | null // null for white/rosé wines
  palate_body: TastingBody | null
  palate_flavour_intensity: TastingIntensity | null
  palate_finish: TastingFinish | null
  // Conclusions
  quality_assessment: TastingQuality | null
  my_rating: MyRating | null
  free_text: string | null
  tags: string[]
}

export interface AdviceEntry {
  id: string
  wine_id: string | null // optional link to a wine entry
  source_name: string
  source_role: AdviceSourceRole
  category: AdviceCategory
  content: string
  captured_at: string // ISO timestamp
}

// ─── Input types ──────────────────────────────────────────────────────────────

export type CreateWineInput = Omit<
  WineEntry,
  'id' | 'date_added' | 'tasting_note_id' | 'advice_linked' | 'expert_reviews' | 'community_sentiment' | 'community_excerpts' | 'price_data'
>
export type UpdateWineInput = Partial<Omit<WineEntry, 'id' | 'date_added'>>
export type CreateTastingNoteInput = Omit<TastingNote, 'id'>
export type CreateAdviceInput = Omit<AdviceEntry, 'id'>
export type UpsertCellarInput = Omit<CellarEntry, 'id' | 'wine_id'>
export type UpsertWishlistInput = Omit<WishlistEntry, 'id' | 'wine_id'>

// ─── Filter types ─────────────────────────────────────────────────────────────

export interface WineFilter {
  status?: WineStatus
  my_rating?: MyRating
  region?: string
  has_tasting_note?: boolean
}

export interface AdviceFilter {
  category?: AdviceCategory
  wine_id?: string
}
