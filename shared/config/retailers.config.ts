export interface RetailerConfig {
  slug: string
  name: string
  domain: string
  /** A specific storefront host for constructed links and nearest-retailer
   *  coordinates when `domain` covers more than one store (Phase 12.2 WI-6).
   *  Review `site:` queries and host matching use `domain`; links the user
   *  clicks use this. */
  storefrontHost?: string
  // Lowercase keyword to match against Serper's shopping `source` field
  // (the merchant display name, e.g. "K&L Wine Merchants"). Serper's `link`
  // field is always a google.com/search?ibp=oshop aggregator URL — it never
  // contains the retailer's domain — so matching must go through `source`.
  matchKeyword: string
  lat: number
  lng: number
  /** Which review-sourcing pass this retailer is searched in (Phase 9.2).
   *  'primary'  — searched for every wine.
   *  'extended' — searched only when the primary pass yields no critic score.
   *  Cost, not trust: an extended retailer is fully trusted, just not paid for
   *  up front. See docs/specs/2026-08-12-phase-9.2-enrichment-cost-reduction.md.
   *  Affects modules/reviews/ only — price discovery, retailer links and
   *  nearest-retailer ranking read the whole list regardless.
   *  'none' (Phase 12.4) — never searched for reviews: a shop that publishes
   *  no critic scores, kept for price, availability and its link only. */
  reviewTier: 'primary' | 'extended' | 'none'
  /** Phase 12.4 WI-2 (developer option (a), 2026-10-31): Google Shopping does
   *  not list this shop, so its price is discovered with one `site:` organic
   *  search per wine (two at most) and a read of the product page — the
   *  structured price when the page carries one, else one GPT-4o call. */
  priceDiscovery?: 'organic'
}

// K&L has a NYC store at 45 W 36th St; all others are their primary locations.
//
// `reviewTier` values below are MEASURED (Phase 9.2, WI-7, 2026-08-15) —
// `npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json
// backend/scripts/validate-reviews.ts` run against the 14-wine 2026-08-04
// batch, untiered (every RETAILER_CONFIG entry probed directly, bypassing
// this file's tiers, so every retailer's real yield could be measured rather
// than assumed). 387 Serper credits spent. Full per-retailer yield table
// (wines searched / zero_results / no_relevant_match / pages found / scores
// for the right producer+vintage / credits spent) is in that run's output;
// see docs/sessions/2026-08-12-phase-9.2-enrichment-cost-reduction.md's
// 2026-08-15 addendum for the captured table. Ranked on scores-per-credit,
// not raw scores: woodland (0.226) and jjbuckley (0.276) clearly earned
// primary; flatiron (0.034) and winelibrary (0.029) are far weaker but still
// nonzero and were the best of the rest. Every other retailer — including
// benchmark, despite carrying real off-vintage pages for several of these
// wines — scored zero right-producer-and-vintage hits across the batch
// while costing among the most credits (36, tied for highest), so it moved
// to extended. Measured p (fraction of wines where the primary tier alone —
// woodland/jjbuckley/flatiron/winelibrary/kl — yielded at least one critic
// score, any vintage) is 7/14 = 0.5, unchanged by benchmark's demotion since
// its one hit (Gour de Chaulé) was already covered by another primary
// retailer. Re-measure if RETAILER_CONFIG's retailer set or the matcher
// changes materially — this is a snapshot of one 14-wine batch on one day,
// not a permanent ranking, and every non-kl/woodland/jjbuckley retailer's
// signal here is thin (most attempts were zero_results or no_relevant_match,
// not a real head-to-head).
//
// Morrell remains 'extended': the honorific-relaxation fix does find its
// page for Jean-Marc Vincent now (verdict: producer=match, vintage=match, a
// real improvement over the pre-fix query-shape failure), but GPT-4o
// extraction failed on that render both times it was tried in this batch, so
// it has yet to convert a correct match into a stored score. Worth
// re-measuring once that's investigated, not a matching problem.
export const RETAILER_CONFIG: RetailerConfig[] = [
  {
    slug: 'kl',
    name: 'K&L Wine Merchants',
    domain: 'klwines.com',
    matchKeyword: 'k&l',
    reviewTier: 'primary',
    lat: 40.758,
    lng: -73.9855,
  },
  {
    slug: 'zachys',
    name: 'Zachys',
    domain: 'zachys.com',
    matchKeyword: 'zachys',
    reviewTier: 'extended',
    lat: 41.0026,
    lng: -73.6693,
  },
  {
    slug: 'woodland',
    name: 'Woodland Hills Wine Co.',
    // Verified 2026-07-15: woodlandhillswine.com has lapsed (parked domain).
    // Current live site is whwc.com — do not revert to the old domain.
    domain: 'whwc.com',
    matchKeyword: 'woodland',
    reviewTier: 'primary',
    lat: 34.1684,
    lng: -118.6059,
  },
  {
    slug: 'benchmark',
    name: 'Benchmark Wine Group',
    domain: 'benchmarkwine.com',
    matchKeyword: 'benchmark',
    // Demoted primary → extended (Phase 9.2, WI-7, 2026-08-15): zero
    // right-producer-and-vintage scores across the 14-wine measured batch
    // despite costing 36 credits — tied for the most expensive retailer in
    // the configured loop. See the file header's measured-tier note.
    reviewTier: 'extended',
    lat: 38.2975,
    lng: -122.2869,
  },
  // Added 2026-07-29 — Phase 6.7 tri-state expansion, specced 2026-07-20 but
  // never actually added to this file until now (see build-phases.md Phase
  // 6.7's "status check" note, now stale as of this change). Sourced from
  // Burghound.com's own published tri-state retailer list; publication
  // coverage confirmed via search-indexed snippets, not a live Puppeteer
  // render — same "verify empirically" caveat as the original four.
  {
    slug: 'sokolin',
    name: 'Sokolin',
    domain: 'sokolin.com',
    matchKeyword: 'sokolin',
    reviewTier: 'extended',
    lat: 40.9376,
    lng: -72.3009,
  },
  {
    slug: 'acker',
    name: 'Acker Wines',
    domain: 'ackerwines.com',
    matchKeyword: 'acker',
    reviewTier: 'extended',
    lat: 40.7796,
    lng: -73.98,
  },
  {
    slug: 'winelibrary',
    name: 'Wine Library',
    domain: 'winelibrary.com',
    matchKeyword: 'wine library',
    reviewTier: 'primary',
    lat: 40.6976,
    lng: -74.3421,
  },
  {
    slug: 'morrell',
    name: 'Morrell & Company',
    domain: 'morrellwine.com',
    matchKeyword: 'morrell',
    reviewTier: 'extended',
    lat: 41.1445,
    lng: -73.8557,
  },
  // Added 2026-07-29 — developer-nominated (shops there, consistently
  // carries attributed critic reviews). Coordinates are approximate
  // (street-level), consistent with the precision used elsewhere in this
  // file. Domain and publication coverage not yet live-verified with
  // Puppeteer — see Phase 7.3's note on unverified on-site search patterns
  // for these three; they fall through to the generic search-URL default
  // in retailer-search-url.ts / build-search-url.ts until confirmed.
  {
    slug: 'crush',
    name: 'Crush Wine & Spirits',
    domain: 'crushwineco.com',
    matchKeyword: 'crush',
    reviewTier: 'extended',
    lat: 40.7614,
    lng: -73.9676,
  },
  {
    slug: 'flatiron',
    name: 'Flatiron Wines & Spirits',
    // REVERSED 2026-10-11 (Phase 12.2 WI-6). This used to be the NYC
    // subdomain alone, "so Phase 7's `site:<domain>` queries land on the right
    // store" — a choice of proximity over coverage. It cost coverage: Joseph
    // Colin's Saint-Aubin En Remilly 2024 page is on sf.flatiron-wines.com
    // (and its slug carries a typo, "2o24"), which `site:nyc.flatiron-wines.com`
    // can never return. Reviews and host matching now use the registrable
    // domain, so both storefronts count as Flatiron — ratings are evidence for
    // the wine, not for proximity. Links the user clicks and nearest-retailer
    // distance stay on the NYC storefront (`storefrontHost`); a product page
    // from another storefront cannot win "nearest" (aggregatePriceData).
    domain: 'flatiron-wines.com',
    storefrontHost: 'nyc.flatiron-wines.com',
    matchKeyword: 'flatiron',
    reviewTier: 'primary',
    lat: 40.7365,
    lng: -73.9905,
  },
  {
    slug: 'thatchers',
    name: "Thatcher's Wine",
    domain: 'thatcherswine.com',
    matchKeyword: 'thatcher',
    reviewTier: 'extended',
    // Brentwood, Los Angeles — not tri-state, unlike every other configured
    // retailer. Included for review coverage only; will essentially never
    // win nearest-retailer ranking against the NYC-based user. Do not treat
    // its presence here as a signal it's geographically relevant.
    lat: 34.0575,
    lng: -118.4741,
  },
  // Added 2026-08-02 — user-reported gap, not a query/matching bug: JJ
  // Buckley carries real attributed critic reviews on real product pages,
  // but modules/reviews/ (and retailer-links/, price/) only ever search
  // retailers present in this file, so a retailer that's simply never been
  // added here produces an empty result indistinguishable from "searched
  // and found nothing." Config-driven per build-phases.md — no logic change
  // needed elsewhere to pick this up. Oakland, CA — like Thatcher's, not
  // tri-state; included for review coverage, will essentially never win
  // nearest-retailer ranking. Domain/on-site search pattern not yet
  // live-verified with Puppeteer — falls through to the generic default
  // guess in @shared/utils/retailer-search-url.ts until confirmed, same
  // caveat as the three developer-nominated retailers above.
  {
    slug: 'jjbuckley',
    name: 'JJ Buckley Fine Wines',
    domain: 'jjbuckley.com',
    matchKeyword: 'jj buckley',
    reviewTier: 'primary',
    // 7307 Edgewater Dr, Oakland, CA 94621 — approximate (street-level),
    // consistent with the precision used elsewhere in this file.
    lat: 37.7458,
    lng: -122.1994,
  },
  // Added 2026-10-31 (Phase 12.4 WI-2) — two shops the developer buys from
  // that Google Shopping does not list: the 2019 La Crau's 40-item Shopping
  // response had no Kermit Lynch at all, though its shop sells that exact
  // wine. Price, availability and link only — neither publishes critic
  // scores, so `reviewTier: 'none'` keeps every review pass off them. Neither
  // has a navigable on-site search (Kermit Lynch's is a client-side Swiftype
  // widget; Astor's an ASP.NET postback — both live-checked with Puppeteer
  // 2026-10-31), so their Search link is a Google site: search, as Morrell's.
  {
    slug: 'kermitlynch',
    name: 'Kermit Lynch Wine Merchant',
    // The shop, not the importer site (kermitlynch.com also hosts producer
    // profiles, which a site: search would return before any product).
    domain: 'shop.kermitlynch.com',
    matchKeyword: 'kermit lynch',
    reviewTier: 'none',
    priceDiscovery: 'organic',
    // 1605 San Pablo Ave, Berkeley, CA — approximate.
    lat: 37.8716,
    lng: -122.2955,
  },
  {
    slug: 'astor',
    name: 'Astor Wines & Spirits',
    domain: 'astorwines.com',
    // "astor wines", not "astor": alphanumeric matching against Serper's
    // `source` would otherwise claim any merchant whose name contains "astor".
    matchKeyword: 'astor wines',
    reviewTier: 'none',
    priceDiscovery: 'organic',
    // 399 Lafayette St, New York, NY — approximate.
    lat: 40.729,
    lng: -73.9922,
  },
]

export const NYC = { lat: 40.7128, lng: -74.006 }
