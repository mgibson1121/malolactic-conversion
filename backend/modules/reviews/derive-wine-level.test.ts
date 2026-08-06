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
