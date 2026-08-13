import type { MatchVerdict } from '@shared/utils/wine-match'
import type { VerificationState } from '@shared/types'

export interface RetailerResult {
  slug: string
  name: string
  price: number | null
  url: string
  is_preferred_retailer: boolean
  distance_miles: number
  // True when `url` is a constructed search-results page rather than a
  // single product page (currently true for every match this module
  // produces, preferred or fallback — see @shared/utils/retailer-search-url.ts). Pricing
  // only ever needs a page that reliably loads and shows the right listing,
  // so this is fine for pricing; it's exactly what modules/reviews/ (Phase
  // 7) needs a *different* page for — see build-phases.md.
  is_search_results_page: boolean
  // Vintage year parsed from the matched listing's title, if any (e.g. a
  // 4-digit 19xx/20xx year). Null if no year could be parsed.
  matched_vintage: number | null
  // True when matched_vintage is known and differs from the wine entry's own
  // vintage — the price/listing shown is for a different year of the same
  // wine, not the exact vintage requested. UI must surface this rather than
  // implying the price applies to the requested vintage.
  vintage_mismatch: boolean
  // Phase 9.1 — 'match' | 'mismatch' | 'unknown' from the graded matcher.
  // vintage_mismatch above cannot distinguish "confirmed same year" from
  // "the listing title never stated one": it was computed as
  // `matched_vintage !== null && …`, so an unstated year read as agreement
  // and the constructed link went out asking for a year the shop may not
  // stock. This field records the third state; vintage_mismatch keeps its
  // existing "confirmed different year" meaning and its existing role in
  // aggregatePriceData, so the price stats don't silently change shape.
  vintage_verdict: MatchVerdict['vintage']
  // Number of standard bottles bundled into this listing's price (1 for an
  // ordinary single-bottle listing). See pack-format.ts.
  pack_quantity: number
  // Parsed bottle volume in mL when the listing states a non-default size
  // (e.g. 1500 for a magnum). Null when unstated (assumed standard 750ml).
  bottle_size_ml: number | null
  // True when this listing is a multi-bottle pack/case or an explicitly
  // non-750ml bottle — its price is not a standard single-bottle price and
  // must be excluded from price_min/avg/max and nearest-retailer selection,
  // the same way a confirmed vintage_mismatch is. Still shown in the
  // retailer list, badged, for transparency.
  non_standard_format: boolean
  // Short UI label for the badge, e.g. "6-pack", "1.5L", "6 x 375ml". Empty
  // string when non_standard_format is false.
  format_label: string
  // True when this entry carries no verifiable price: show the link, keep it
  // out of price_min/avg/max and nearest_retailer (aggregatePriceData), and
  // never let it satisfy Pass 1's "a preferred retailer matched" condition
  // (querySerper), so a wine only such an entry covers still cascades to
  // retailers with real, checkable pricing.
  //
  // Two cases produce it. The original (2026-07-30) is the always-added K&L
  // entry (see buildKlLinkOnlyResult in index.ts): K&L's own site blocks
  // Puppeteer behind a bot-detection challenge, so nothing about its price
  // can actually be verified — rather than let a Serper-sourced K&L price
  // silently pass verify-listing.ts's "still listed" check unchecked (a
  // bot-challenge stub never contains a "no results" phrase, so it always
  // reads as confirmed), K&L is excluded from Serper-sourced matching
  // entirely and instead gets a single no-price entry pointing at its own
  // site search.
  //
  // The second (Phase 9.1) is a retailer contributed by a confirmed product
  // page from modules/reviews/ (see ConfirmedProductPage below). Serper's
  // Shopping endpoint returned no price for it, but a rendered product page
  // is proof the shop carries the wine — worth a link, not worth a price
  // the pipeline never actually saw.
  link_only: boolean
  // Phase 9.1 — what verify-listing actually established about this entry,
  // rather than collapsing "checked and confirmed" and "couldn't check" into
  // the same silent pass. See VerificationState in shared/types.ts.
  verification: VerificationState
}

/**
 * A product page another module has already confirmed carries this wine
 * (Phase 9.1). Passed in by the router — modules never import each other
 * (CLAUDE.md §5) — from review_data, whose entries are real rendered product
 * pages that passed the graded matcher.
 *
 * This is the strongest possible evidence a shop stocks a wine, and it was
 * being thrown away by the module that needs it: reviews/ found a live
 * Woodland Hills product page for Mangot 2022 with 7 critic scores while
 * price/ returned zero retailers for the same wine in the same run.
 */
export interface ConfirmedProductPage {
  slug: string
  name: string
  product_url: string
  /**
   * The price stated on that product page, when the extraction read one
   * (2026-08-05).
   *
   * This is not blending across sources (CLAUDE.md §15) — it is the
   * retailer's own price, read off the retailer's own product page, and
   * attributed to that retailer. It is *better* evidence than Serper's
   * Google Shopping snapshot, which is what the rest of this module runs on
   * and which can be stale. Passing null here was over-cautious: it left
   * preferred retailers showing no price at all when the pipeline had one in
   * hand.
   */
  price: number | null
}

export interface PriceData {
  price_min: number | null
  price_avg: number | null
  price_max: number | null
  // Prices found for a different vintage of the same wine (2026-08-05) —
  // see shared/types.ts PriceData for the field-level docs this mirrors.
  other_vintage_price_range: { min: number; max: number } | null
  retailers: RetailerResult[]
  nearest_retailer: RetailerResult | null
  fetched_at: string
}
