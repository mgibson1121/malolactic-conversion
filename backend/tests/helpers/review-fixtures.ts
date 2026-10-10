import type { CriticScore, RetailerReview } from '@shared/types'

export function score(
  publication: string,
  value: number,
  opts: { known?: boolean; window?: [number, number] | null } = {}
): CriticScore {
  return {
    publication,
    score: value,
    known_publication: opts.known ?? true,
    drinking_window: opts.window ? { start: opts.window[0], end: opts.window[1] } : null,
    vintage_character: null,
    deal: false,
  }
}

/** One retailer's review entry. `pageVintage` null = the page states none. */
export function review(
  slug: string,
  pageVintage: number | null,
  scores: CriticScore[],
  vintageVerdict: 'match' | 'mismatch' | 'unknown' = pageVintage === null ? 'unknown' : 'match'
): RetailerReview {
  return {
    slug,
    name: slug,
    product_url: `https://${slug}.example/p`,
    critic_scores: scores,
    fetched_at: '2026-10-01T00:00:00.000Z',
    source: 'configured',
    page_vintage: pageVintage,
    vintage_gap: null,
    match: {
      producer: 'match',
      denomination: 'match',
      bottling: 'unknown',
      vintage: vintageVerdict,
      candidateVintage: pageVintage,
      vintageGap: null,
    },
    page_price: null,
  }
}
