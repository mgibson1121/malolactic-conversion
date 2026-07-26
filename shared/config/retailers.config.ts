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
]

export const NYC = { lat: 40.7128, lng: -74.006 }
