export interface RetailerConfig {
  slug: string
  name: string
  domain: string
  lat: number
  lng: number
}

// K&L has a NYC store at 45 W 36th St; all others are their primary locations.
export const RETAILER_CONFIG: RetailerConfig[] = [
  {
    slug: 'kl',
    name: 'K&L Wine Merchants',
    domain: 'klwines.com',
    lat: 40.758,
    lng: -73.9855,
  },
  {
    slug: 'zachys',
    name: 'Zachys',
    domain: 'zachys.com',
    lat: 41.0026,
    lng: -73.6693,
  },
  {
    slug: 'woodland',
    name: 'Woodland Hills Wine Co.',
    domain: 'woodlandhillswine.com',
    lat: 34.1684,
    lng: -118.6059,
  },
  {
    slug: 'benchmark',
    name: 'Benchmark Wine Group',
    domain: 'benchmarkwine.com',
    lat: 38.2975,
    lng: -122.2869,
  },
]

export const NYC = { lat: 40.7128, lng: -74.006 }
