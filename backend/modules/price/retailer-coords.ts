// Static retailer coordinates for nearest-to-NYC calculation.
// K&L has no NYC store; San Francisco flagship used.
// Verify these against live retailer sites before relying on proximity results.

export interface RetailerCoords {
  slug: string
  name: string
  lat: number
  lng: number
  searchUrl: (query: string) => string
}

const NYC = { lat: 40.7128, lng: -74.006 }
export { NYC }

export const RETAILERS: RetailerCoords[] = [
  {
    slug: 'kl',
    name: 'K&L Wine Merchants',
    lat: 40.7580,
    lng: -73.9855,
    // K&L has a NYC store at 45 W 36th St
    searchUrl: (q) => `https://www.klwines.com/p/grapes?&q=${encodeURIComponent(q)}&sTp=Product`,
  },
  {
    slug: 'zachys',
    name: 'Zachys',
    lat: 41.0026,
    lng: -73.6693,
    searchUrl: (q) => `https://www.zachys.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    slug: 'woodland',
    name: 'Woodland Hills Wine Company',
    lat: 34.1684,
    lng: -118.6059,
    searchUrl: (q) => `https://www.woodlandhillswine.com/search?type=product&q=${encodeURIComponent(q)}`,
  },
  {
    slug: 'benchmark',
    name: 'Benchmark Wine Group',
    lat: 38.2975,
    lng: -122.2869,
    searchUrl: (q) => `https://www.benchmarkwine.com/search?q=${encodeURIComponent(q)}`,
  },
]
