import type { MatchVerdict } from './utils/wine-match'

// ─── Enrichment types ─────────────────────────────────────────────────────────

export interface ExpertReview {
  source: string         // e.g. "Burghound", "Vinous"
  score: number | null
  tasting_note: string | null
  drinking_window: DrinkingWindow | null
  fetched_at: string     // ISO timestamp
}

// Year range stated in a critic citation (e.g. "drink 2028-2040"). Distinct
// from DrinkingWindow (wine-level, ISO dates) — this is what's directly
// extractable from source text, a year, not a date.
export interface CriticDrinkingWindow {
  start: number | null
  end: number | null
}

export interface CriticScore {
  publication: string   // canonical name if known_publication, otherwise raw attribution text as GPT-4o returned it
  score: number
  // True when `publication` was normalized against CRITIC_KEYWORDS
  // (backend/modules/reviews/critic-keywords.ts). False means the score was
  // still captured — capture is never gated on this list — but the
  // attribution is unrecognized/unnormalized raw text.
  known_publication: boolean
  // Phase 8 — extracted from the same citation window, when the source text
  // states one. Null when absent; never inferred or interpolated.
  drinking_window: CriticDrinkingWindow | null
  // Phase 8 — populated only when the source characterizes the vintage as a
  // whole, not just this specific wine. Null when the source doesn't.
  vintage_character: VintageRating | null
  // Phase 8 — true only when the source explicitly signals value/QPR
  // ("great value", "overdelivers"). Never inferred from score-to-price ratio.
  deal: boolean
}

/**
 * What the live-page check in backend/modules/price/verify-listing.ts was
 * actually able to establish (Phase 9.1, 2026-08-04).
 *
 * - 'verified'   — the retailer's live search page rendered and its visible
 *                  text contains every significant word of the producer.
 * - 'unverified' — the check could not be completed: the render failed or
 *                  timed out, or the wine entry records no producer to look
 *                  for. The listing is kept (an infra hiccup is not evidence
 *                  the wine is gone) but must not be presented as confirmed.
 * - 'unchecked'  — verification was never attempted for this entry. Covers
 *                  K&L's link-only entry (its site blocks the renderer) and
 *                  product pages contributed by modules/reviews/, which that
 *                  module already rendered.
 *
 * Before this existed, a render failure returned the retailer unchanged, so
 * an unverifiable listing was indistinguishable from a verified one all the
 * way to the UI.
 */
export type VerificationState = 'verified' | 'unverified' | 'unchecked'

export interface RetailerPrice {
  slug: string          // e.g. "kl", "zachys"
  name: string
  price: number | null
  url: string
  distance_miles: number
  is_preferred_retailer: boolean
  // True when `url` is a constructed search-results page rather than a
  // single product page — see backend/modules/price/retailer-search-url.ts.
  is_search_results_page: boolean
  // Vintage year parsed from the matched listing's title, if any.
  matched_vintage: number | null
  // True when matched_vintage differs from this wine entry's own vintage —
  // the price/listing shown is for a different year of the same wine.
  vintage_mismatch: boolean
  // Phase 9.1 (2026-08-04) — the vintage dimension of the match verdict this
  // listing was accepted on. `vintage_mismatch` above is a boolean and so
  // cannot distinguish "confirmed same year" from "the listing title never
  // said" — it read false for both, which is why six dead links went out for
  // listings whose year was simply unstated. Both are kept: vintage_mismatch
  // still means *confirmed* different year (and still gates the price stats),
  // while this field makes the unknown case visible instead of silently
  // counting as agreement.
  vintage_verdict: MatchVerdict['vintage']
  // Number of standard bottles bundled into this listing's price (1 for an
  // ordinary single-bottle listing).
  pack_quantity: number
  // Parsed bottle volume in mL when the listing states a non-default size
  // (e.g. 1500 for a magnum). Null when unstated (assumed standard 750ml).
  bottle_size_ml: number | null
  // True when this listing is a multi-bottle pack/case or an explicitly
  // non-750ml bottle — its price is excluded from price_min/avg/max and
  // nearest-retailer selection, but still shown in the retailer list, badged.
  non_standard_format: boolean
  // Short UI label for the badge, e.g. "6-pack", "1.5L". Empty string when
  // non_standard_format is false.
  format_label: string
  // True only for K&L's always-present, no-price entry (2026-07-30) — K&L's
  // own site blocks Puppeteer behind a bot-detection challenge, so its price
  // can never actually be verified. Shown so the wine can still be searched
  // on K&L (where most of the developer's target wines are found), but
  // excluded from price_min/avg/max and nearest_retailer, and never treated
  // as a successful preferred-retailer match — see backend/modules/price/index.ts.
  link_only: boolean
  // Phase 9.1 — what the live-page check established about this listing.
  // 'unverified' must not be shown as though it were confirmed.
  verification: VerificationState
}

// Phase 9.2 — mirrors backend/modules/reviews/find-product-page.ts's
// Step1Stage. Duplicated rather than imported: shared/ is imported by
// backend modules, never the reverse (CLAUDE.md §5), and this is the
// smallest fact from that stage type that a storage-level record needs to
// carry, not the full pipeline vocabulary.
export type ReviewProbeStage = 'request_failed' | 'zero_results' | 'no_relevant_match' | 'found'

export interface ReviewProbeLogEntry {
  slug: string
  domain: string
  stage: ReviewProbeStage
  variants_tried: number
  probed_at: string // ISO timestamp
}

export interface RetailerLink {
  slug: string
  name: string
  url: string
}

// Per-retailer result stored in review_data (Phase 7) — sourced from a real
// rendered product page, never a search-results page. Deliberately separate
// from RetailerPrice.critic_scores, which was always guaranteed empty (see
// docs/build-phases.md Phase 9 "Known gap") and has been removed above.
export interface RetailerReview {
  slug: string
  name: string
  product_url: string
  critic_scores: CriticScore[]
  fetched_at: string     // ISO timestamp
  // 'configured' — from a retailer in RETAILER_CONFIG (automated or
  // manually confirmed via confirm-retailer-link). 'fallback' — from the
  // open-web fallback pass (Phase 7.3, 2026-08-02), which only runs when no
  // configured retailer returned a critic score; the domain isn't one the
  // developer has explicitly vetted, so the UI should treat it with less
  // confidence than a 'configured' entry.
  source: 'configured' | 'fallback'
  // Phase 9.1 (2026-08-04) — the vintage the extracted page itself states,
  // preferring GPT-4o's reading of the rendered page over a year parsed out
  // of the search-result title. Null when the page states none. Before this,
  // GptPageExtraction.vintage was computed on every call and then dropped on
  // the floor, which is how nine Chateau Lafleur scores and a 2010 Gour de
  // Chaule ended up stored against 2022 wines.
  page_vintage: number | null
  // Years between page_vintage and the wine's own vintage. Null when either
  // side is unknown. Deliberately not a boolean and deliberately not a
  // filter: a wrong-vintage page is kept and badged (e.g. "2020 · 2 years
  // earlier"), never hidden — rejecting it yields nothing instead of
  // something. The display layer owns the threshold at which a gap reads as
  // notable; the pipeline only records it.
  vintage_gap: number | null
  // The per-dimension verdict this result was accepted on. Stored so the UI
  // can say which dimension is uncertain and validate-reviews.ts can report
  // *why* a candidate was rejected, rather than re-deriving either.
  match: MatchVerdict
  // The price stated on this product page, when the extraction read one
  // (2026-08-05). Like page_vintage before it, GptPageExtraction has always
  // returned this and it was being dropped — which is why a preferred
  // retailer whose product page the pipeline had rendered still showed no
  // price. The router feeds it to modules/price/, where it becomes that
  // retailer's price: the shop's own figure from the shop's own page, not a
  // blend across sources.
  page_price: number | null
}

/** A price range over some set of listings. Null bounds mean the set was
 * empty. */
export interface PriceRange {
  min: number
  max: number
}

export interface PriceData {
  // Headline stats. Computed over standard-format, single-bottle listings of
  // *this* vintage only, with statistical outliers excluded — see
  // aggregatePriceData in backend/modules/price/.
  price_min: number | null
  price_avg: number | null
  price_max: number | null
  // Prices found for a *different* vintage of the same wine (2026-08-05).
  // Kept out of the headline figures above — a 2020's price is not the 2022's
  // — but reported, because "no price" and "no price for this year, though
  // the 2021 runs $28–$150" are very different things to show. Several wines
  // in the 2026-08-04 batch had five real prices and displayed nothing.
  other_vintage_price_range: PriceRange | null
  retailers: RetailerPrice[]
  nearest_retailer: RetailerPrice | null
  fetched_at: string     // ISO timestamp
}

// ─── Enum types ───────────────────────────────────────────────────────────────

export type CellarCategory = 'table' | 'near_term' | 'long_term'
export type VintageRating = 'below_avg' | 'avg' | 'good' | 'very_good'
// Phase 10.5 — Tier 2, same nullable-by-design treatment as quality_classification.
// Populated by label-scan extraction when the label states it explicitly, or set
// by hand via PATCH; never inferred from grape_varieties (free-text, unreliable).
export type WineColor = 'red' | 'white' | 'rosé'
// Phase 8 — tracks whether drinking_window/vintage_rating on a WineEntry was
// set by hand or derived from review extraction; see WineEntry fields below.
export type FieldProvenance = 'manual' | 'derived' | null
export type MyRating = 'poor' | 'acceptable' | 'good' | 'very_good' | 'outstanding'

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
  wine_color: WineColor | null  // Phase 10.5 — see WineColor above
  label_image_url: string | null
  // List tags — additive booleans; a wine can carry any combination simultaneously
  tag_discovered: boolean   // set automatically on creation
  tag_wishlist: boolean
  tag_cellar: boolean
  tag_consumed: boolean     // set automatically when first tasting note is saved
  cellar_quantity: number   // number of bottles in the cellar; 0 by default
  cellar_category: CellarCategory | null
  drinking_window: DrinkingWindow | null
  // Phase 8 — 'manual' once the developer has set/edited drinking_window
  // directly; a manual value is never overwritten by a later automated
  // extraction run. 'derived' means the current value came from a single
  // non-disagreeing critic citation in review_data. Null before either has
  // happened.
  drinking_window_source: FieldProvenance
  vintage_rating: VintageRating | null
  // Phase 8 — same manual/derived/null provenance as drinking_window_source,
  // guarding vintage_rating the same way.
  vintage_rating_source: FieldProvenance
  my_rating: MyRating | null
  my_tags: string[]
  wishlist_notes: string | null
  price_paid: number | null
  purchased_from: string | null
  latest_tasting_note_id: string | null   // FK to most recent tasting note; set by createTastingNote
  advice_linked: string[] | null          // advice UUIDs; appended by createAdvice
  expert_reviews: ExpertReview[] | null   // null until Phase 6 modules populate
  community_sentiment: string | null      // GPT-4o synthesis; null if no key configured
  community_excerpts: string[] | null     // raw Reddit excerpts; fallback when no LLM key
  price_data: PriceData | null            // null until Phase 6 price module populates
  retailer_links?: Record<string, string> | null  // user-saved retailer URLs keyed by slug; null until user saves
  review_data?: RetailerReview[] | null   // null until Phase 7 reviews module populates
  // Phase 9.2 — one entry per retailer per fetch-reviews run, from the
  // Step1Outcome findProductPageDetailed already returns (previously read
  // only by validate-reviews.ts). A retailer whose most recent entry is
  // stage: 'zero_results' and newer than NEGATIVE_PROBE_TTL_DAYS is skipped
  // on the next run — a shop's absence of a page for this bottling does not
  // change week to week the way prices do. Never skipped on
  // 'request_failed': that conflation (a transient failure read as "found
  // nothing") is what erased eight wines' review_data on 2026-08-05, and
  // this log must not recreate it with a longer fuse.
  review_probe_log?: ReviewProbeLogEntry[] | null
  date_added: string                      // ISO timestamp
  date_first_consumed: string | null      // ISO timestamp; set once when tag_consumed first becomes true
  // Phase 9.4 — NULL means draft: persisted (so scan-time enrichment has a
  // row to attach to) but excluded from every list, count, and query until
  // the developer promotes it (POST /:id/promote) with at least one list
  // tag. Set once, on promotion; never cleared. See CLAUDE.md §3.
  promoted_at: string | null
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
  'id' | 'date_added' | 'latest_tasting_note_id' | 'advice_linked' | 'expert_reviews' | 'community_sentiment' | 'community_excerpts' | 'price_data' | 'review_data' | 'drinking_window_source' | 'vintage_rating_source' | 'promoted_at'
>
export type UpdateWineInput = Partial<Omit<WineEntry, 'id' | 'date_added'>>
export type CreateTastingNoteInput = Omit<TastingNote, 'id'>
export type CreateAdviceInput = Omit<AdviceEntry, 'id'>

// ─── Filter types ─────────────────────────────────────────────────────────────

export interface WineFilter {
  tag_discovered?: boolean
  tag_wishlist?: boolean
  tag_cellar?: boolean
  tag_consumed?: boolean
  has_tasting_note?: boolean
  my_rating?: MyRating
  region?: string
  // Phase 9.4 — false by default, so every existing caller keeps excluding
  // drafts without modification. True includes wines with promoted_at NULL.
  include_drafts?: boolean
  // Phase 10.5 — substring match across producer/denomination/vineyard/cuvee.
  q?: string
}

export interface AdviceFilter {
  category?: AdviceCategory
  wine_id?: string
}

// Phase 10.5 — a single app-level row, not per-wine. cellar_capacity is a
// user-set total bottle-slot count; null means unset (no stat computed yet).
export interface AppSettings {
  cellar_capacity: number | null
}
