/**
 * A retailer is a registrable domain, not a host (Phase 12.2 WI-6).
 *
 * `nyc.flatiron-wines.com` and `sf.flatiron-wines.com` are one shop with two
 * storefronts, and a Colin Saint-Aubin's ratings were on the `sf.` page while
 * review discovery, configured with the `nyc.` host, asked Serper for
 * `site:nyc.flatiron-wines.com` and could never see it. Matching and `site:`
 * queries use this domain; the nearest-retailer coordinates stay per store.
 *
 * Not the full public-suffix list: the handful of two-part suffixes below are
 * the ones a wine retailer on this project's list could plausibly sit under.
 */
const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'com.au', 'co.nz', 'com.br', 'co.jp', 'com.sg', 'com.hk'])

export function registrableDomain(host: string | null | undefined): string {
  const labels = (host ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/:?#].*$/, '')
    .split('.')
    .filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  return TWO_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
}

/** True when both hosts belong to the same registrable domain (www., nyc., sf., shop. ... all fold). */
export function sameRegistrableDomain(a: string | null | undefined, b: string | null | undefined): boolean {
  const ra = registrableDomain(a)
  const rb = registrableDomain(b)
  return ra !== '' && ra === rb
}
