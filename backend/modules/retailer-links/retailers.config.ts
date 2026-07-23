export interface RetailerLinkConfig {
  slug: string
  name: string
  domain: string
}

// Local to this module by design — modules do not import from each other
// (CLAUDE.md §5). Duplicates backend/modules/price/retailers.config.ts for
// the same four retailers; both copies move to shared/config/retailers.config.ts
// in Phase 7 once modules/reviews/ needs the same data.
//
// The woodland domain is whwc.com, not woodlandhillswine.com — the latter
// lapsed to a parked domain (found 2026-07-15, recorded in the price
// module's copy of this config). Do not revert to the old domain.
export const RETAILER_CONFIG: RetailerLinkConfig[] = [
  { slug: 'kl', name: 'K&L Wine Merchants', domain: 'klwines.com' },
  { slug: 'zachys', name: 'Zachys', domain: 'zachys.com' },
  { slug: 'woodland', name: 'Woodland Hills Wine Co.', domain: 'whwc.com' },
  { slug: 'benchmark', name: 'Benchmark Wine Group', domain: 'benchmarkwine.com' },
]
