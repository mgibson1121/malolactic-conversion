export interface RetailerConfig {
  slug: string
  name: string
  domain: string
  // Lowercase keyword to match against Serper's shopping `source` field
  // (the merchant display name, e.g. "K&L Wine Merchants"). Serper's `link`
  // field is always a google.com/search?ibp=oshop aggregator URL — it never
  // contains the retailer's domain — so matching must go through `source`.
  matchKeyword: string
  lat: number
  lng: number
}

// K&L has a NYC store at 45 W 36th St; all others are their primary locations.
export const RETAILER_CONFIG: RetailerConfig[] = [
  {
    slug: 'kl',
    name: 'K&L Wine Merchants',
    domain: 'klwines.com',
    matchKeyword: 'k&l',
    lat: 40.758,
    lng: -73.9855,
  },
  {
    slug: 'zachys',
    name: 'Zachys',
    domain: 'zachys.com',
    matchKeyword: 'zachys',
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
    lat: 34.1684,
    lng: -118.6059,
  },
  {
    slug: 'benchmark',
    name: 'Benchmark Wine Group',
    domain: 'benchmarkwine.com',
    matchKeyword: 'benchmark',
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
    lat: 40.9376,
    lng: -72.3009,
  },
  {
    slug: 'acker',
    name: 'Acker Wines',
    domain: 'ackerwines.com',
    matchKeyword: 'acker',
    lat: 40.7796,
    lng: -73.98,
  },
  {
    slug: 'winelibrary',
    name: 'Wine Library',
    domain: 'winelibrary.com',
    matchKeyword: 'wine library',
    lat: 40.6976,
    lng: -74.3421,
  },
  {
    slug: 'morrell',
    name: 'Morrell & Company',
    domain: 'morrellwine.com',
    matchKeyword: 'morrell',
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
    lat: 40.7614,
    lng: -73.9676,
  },
  {
    slug: 'flatiron',
    name: 'Flatiron Wines & Spirits',
    // NYC storefront is served from this subdomain, not the bare
    // flatiron-wines.com root (which also serves their SF location) — using
    // the NYC subdomain here so Phase 7's `site:<domain>` queries land on
    // the right store. Re-verify if `site:` results come back empty.
    domain: 'nyc.flatiron-wines.com',
    matchKeyword: 'flatiron',
    lat: 40.7365,
    lng: -73.9905,
  },
  {
    slug: 'thatchers',
    name: "Thatcher's Wine",
    domain: 'thatcherswine.com',
    matchKeyword: 'thatcher',
    // Brentwood, Los Angeles — not tri-state, unlike every other configured
    // retailer. Included for review coverage only; will essentially never
    // win nearest-retailer ranking against the NYC-based user. Do not treat
    // its presence here as a signal it's geographically relevant.
    lat: 34.0575,
    lng: -118.4741,
  },
]

export const NYC = { lat: 40.7128, lng: -74.006 }
