import { deriveWineLevelFields } from './derive-wine-level'
import type { RetailerReview } from '@shared/types'

// Defaults to a right-producer/right-vintage page — the case where derivation
// is supposed to run. Tests that exercise the Phase 9.1 vintage gate override
// `match` (and page_vintage/vintage_gap alongside it, to keep the fixture
// self-consistent) rather than relying on a second builder.
function makeReview(overrides: Partial<RetailerReview> = {}): RetailerReview {
  return {
    slug: 'kl',
    name: 'K&L Wine Merchants',
    product_url: 'https://shop.klwines.com/p/1',
    critic_scores: [],
    fetched_at: '2026-07-29T00:00:00.000Z',
    source: 'configured',
    page_vintage: 2019,
    vintage_gap: 0,
    match: {
      producer: 'match',
      denomination: 'match',
      bottling: 'unknown',
      vintage: 'match',
      candidateVintage: 2019,
      vintageGap: 0,
    },
    ...overrides,
  }
}

const UNSET = { drinking_window_source: null, vintage_rating_source: null } as const

/** A page for a different year of the same wine — the most common real
 * outcome in the 2026-08-04 batch. Its scores stay in review_data; they just
 * can't speak for this vintage. */
function wrongVintage(gap = 2): Pick<RetailerReview, 'page_vintage' | 'vintage_gap' | 'match'> {
  return {
    page_vintage: 2019 - gap,
    vintage_gap: gap,
    match: {
      producer: 'match',
      denomination: 'match',
      bottling: 'unknown',
      vintage: 'mismatch',
      candidateVintage: 2019 - gap,
      vintageGap: gap,
    },
  }
}

/** A page that never stated a year — indistinguishable from a match under
 * the old fail-open computation. */
const UNKNOWN_VINTAGE: Pick<RetailerReview, 'page_vintage' | 'vintage_gap' | 'match'> = {
  page_vintage: null,
  vintage_gap: null,
  match: {
    producer: 'match',
    denomination: 'match',
    bottling: 'unknown',
    vintage: 'unknown',
    candidateVintage: null,
    vintageGap: null,
  },
}

// ─── Vintage gate (Phase 9.1, WI-3) ────────────────────────────────────────
// drinking_window and vintage_rating are statements about a specific year.
// A 2020's drink-from window is not a fact about the 2022, however good the
// source, so only vintage-matched results may derive them.
describe('deriveWineLevelFields — vintage gate', () => {
  it('ignores a drinking window cited on a wrong-vintage page', () => {
    const reviewData = [
      makeReview({
        ...wrongVintage(),
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: { start: 2028, end: 2040 }, vintage_character: null, deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, UNSET)

    // No signal at all rather than a wrong one — leave the field alone.
    expect(updates.drinking_window).toBeUndefined()
    expect(updates.drinking_window_source).toBeUndefined()
    // The score itself is untouched; it lives in review_data, badged.
    expect(reviewData[0].critic_scores[0].drinking_window).toEqual({ start: 2028, end: 2040 })
  })

  it('ignores a vintage character cited on a page that never stated a year', () => {
    const reviewData = [
      makeReview({
        ...UNKNOWN_VINTAGE,
        critic_scores: [
          { publication: 'Vinous', score: 93, known_publication: true, drinking_window: null, vintage_character: 'very_good', deal: false },
        ],
      }),
    ]

    expect(deriveWineLevelFields(reviewData, UNSET).vintage_rating).toBeUndefined()
  })

  it('derives from the vintage-matched result and ignores the mismatched one alongside it', () => {
    // The exact case that produced a wrong vintage_rating for Mangot: a
    // disagreement that only exists because one source is a different year.
    const reviewData = [
      makeReview({
        slug: 'benchmark',
        name: 'Benchmark Wine Group',
        ...wrongVintage(),
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: { start: 2026, end: 2036 }, vintage_character: 'good', deal: false },
        ],
      }),
      makeReview({
        slug: 'zachys',
        name: 'Zachys',
        critic_scores: [
          { publication: 'Vinous', score: 95, known_publication: true, drinking_window: { start: 2030, end: 2045 }, vintage_character: 'very_good', deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, UNSET)

    expect(updates.drinking_window).toEqual({ start: '2030-01-01', end: '2045-01-01' })
    expect(updates.vintage_rating).toBe('very_good')
  })

  it('leaves both fields alone when every result is a wrong vintage', () => {
    const reviewData = [
      makeReview({ ...wrongVintage(1), critic_scores: [{ publication: 'Vinous', score: 93, known_publication: true, drinking_window: { start: 2027, end: 2037 }, vintage_character: 'good', deal: false }] }),
      makeReview({ slug: 'zachys', name: 'Zachys', ...wrongVintage(3), critic_scores: [{ publication: 'Decanter', score: 96, known_publication: true, drinking_window: { start: 2025, end: 2035 }, vintage_character: 'avg', deal: false }] }),
    ]

    const updates = deriveWineLevelFields(reviewData, UNSET)

    expect(updates.drinking_window).toBeUndefined()
    expect(updates.vintage_rating).toBeUndefined()
  })
})

describe('deriveWineLevelFields', () => {
  it('populates the wine-level drinking window when exactly one critic states one', () => {
    const reviewData = [
      makeReview({
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: { start: 2028, end: 2040 }, vintage_character: null, deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, UNSET)

    expect(updates.drinking_window).toEqual({ start: '2028-01-01', end: '2040-01-01' })
    expect(updates.drinking_window_source).toBe('derived')
  })

  it('leaves the wine-level drinking window null when two critics disagree, while both windows remain in review_data', () => {
    const reviewData = [
      makeReview({
        slug: 'kl',
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: { start: 2028, end: 2040 }, vintage_character: null, deal: false },
        ],
      }),
      makeReview({
        slug: 'zachys',
        name: 'Zachys',
        critic_scores: [
          { publication: 'Vinous', score: 95, known_publication: true, drinking_window: { start: 2030, end: 2045 }, vintage_character: null, deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, UNSET)

    expect(updates.drinking_window).toBeNull()
    expect(updates.drinking_window_source).toBe('derived')
    // Per-critic data is untouched — it lives in review_data, not in this function's output.
    expect(reviewData[0].critic_scores[0].drinking_window).toEqual({ start: 2028, end: 2040 })
    expect(reviewData[1].critic_scores[0].drinking_window).toEqual({ start: 2030, end: 2045 })
  })

  it('does not treat two critics citing the identical window as a disagreement', () => {
    const reviewData = [
      makeReview({
        slug: 'kl',
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: { start: 2028, end: 2040 }, vintage_character: null, deal: false },
        ],
      }),
      makeReview({
        slug: 'zachys',
        name: 'Zachys',
        critic_scores: [
          { publication: 'Vinous', score: 95, known_publication: true, drinking_window: { start: 2028, end: 2040 }, vintage_character: null, deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, UNSET)

    expect(updates.drinking_window).toEqual({ start: '2028-01-01', end: '2040-01-01' })
  })

  it('leaves drinking_window untouched (no key in the returned object) when no critic states one at all', () => {
    const reviewData = [makeReview({ critic_scores: [{ publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: null, vintage_character: null, deal: false }] })]

    const updates = deriveWineLevelFields(reviewData, UNSET)

    expect(updates.drinking_window).toBeUndefined()
    expect(updates.drinking_window_source).toBeUndefined()
  })

  it('never overwrites a manually-set drinking window, even when review_data has a single agreeing critic', () => {
    const reviewData = [
      makeReview({
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: { start: 2028, end: 2040 }, vintage_character: null, deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, { drinking_window_source: 'manual', vintage_rating_source: null })

    expect(updates.drinking_window).toBeUndefined()
    expect(updates.drinking_window_source).toBeUndefined()
  })

  it('populates vintage_rating when exactly one critic characterizes the vintage broadly', () => {
    const reviewData = [
      makeReview({
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: null, vintage_character: 'very_good', deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, UNSET)

    expect(updates.vintage_rating).toBe('very_good')
    expect(updates.vintage_rating_source).toBe('derived')
  })

  it('leaves vintage_rating null when critics disagree on vintage character', () => {
    const reviewData = [
      makeReview({
        slug: 'kl',
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: null, vintage_character: 'good', deal: false },
        ],
      }),
      makeReview({
        slug: 'zachys',
        name: 'Zachys',
        critic_scores: [
          { publication: 'Vinous', score: 95, known_publication: true, drinking_window: null, vintage_character: 'very_good', deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, UNSET)

    expect(updates.vintage_rating).toBeNull()
  })

  it('never overwrites a manually-set vintage_rating', () => {
    const reviewData = [
      makeReview({
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: null, vintage_character: 'good', deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, { drinking_window_source: null, vintage_rating_source: 'manual' })

    expect(updates.vintage_rating).toBeUndefined()
    expect(updates.vintage_rating_source).toBeUndefined()
  })

  it('derives drinking_window and vintage_rating independently — a manual override on one does not block the other', () => {
    const reviewData = [
      makeReview({
        critic_scores: [
          { publication: 'Wine Advocate', score: 94, known_publication: true, drinking_window: { start: 2028, end: 2040 }, vintage_character: 'good', deal: false },
        ],
      }),
    ]

    const updates = deriveWineLevelFields(reviewData, { drinking_window_source: 'manual', vintage_rating_source: null })

    expect(updates.drinking_window).toBeUndefined()
    expect(updates.vintage_rating).toBe('good')
    expect(updates.vintage_rating_source).toBe('derived')
  })
})
