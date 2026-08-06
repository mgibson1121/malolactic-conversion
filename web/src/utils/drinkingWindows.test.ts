import type { CriticScore, RetailerReview } from '@shared/types'
import { getAttributedDrinkingWindows } from './drinkingWindows'

function score(
  publication: string,
  drinking_window: CriticScore['drinking_window'],
  overrides: Partial<CriticScore> = {}
): CriticScore {
  return {
    publication,
    score: 95,
    known_publication: true,
    drinking_window,
    vintage_character: null,
    deal: false,
    ...overrides,
  }
}

function review(slug: string, critic_scores: CriticScore[]): RetailerReview {
  return {
    slug,
    critic_scores,
    fetched_at: '2026-08-05T00:00:00.000Z',
    source: 'configured',
  } as RetailerReview
}

describe('getAttributedDrinkingWindows', () => {
  it('returns nothing when there is no review data', () => {
    expect(getAttributedDrinkingWindows(null)).toEqual([])
    expect(getAttributedDrinkingWindows(undefined)).toEqual([])
    expect(getAttributedDrinkingWindows([])).toEqual([])
  })

  it('returns one entry per distinct window, attributed to its critic', () => {
    const windows = getAttributedDrinkingWindows([
      review('jjbuckley', [
        score('Decanter', { start: 2029, end: 2045 }),
        score('Vinous', { start: 2026, end: 2038 }),
      ]),
    ])

    expect(windows).toEqual([
      { start: 2029, end: 2045, publications: ['Decanter'] },
      { start: 2026, end: 2038, publications: ['Vinous'] },
    ])
  })

  it('groups critics who state the same window rather than repeating it', () => {
    const windows = getAttributedDrinkingWindows([
      review('jjbuckley', [
        score('Decanter', { start: 2029, end: 2045 }),
        score('Wine Advocate', { start: 2029, end: 2045 }),
        score('Vinous', { start: 2026, end: 2038 }),
      ]),
    ])

    expect(windows).toEqual([
      { start: 2029, end: 2045, publications: ['Decanter', 'Wine Advocate'] },
      { start: 2026, end: 2038, publications: ['Vinous'] },
    ])
  })

  // One critic syndicated across retailers is one opinion, not agreement with
  // itself — getDedupedCriticScores collapses it before grouping.
  it('counts a publication once when it appears on several retailers', () => {
    const windows = getAttributedDrinkingWindows([
      review('jjbuckley', [score('Decanter', { start: 2029, end: 2045 })]),
      review('kl', [score('Decanter', { start: 2029, end: 2045 })]),
    ])

    expect(windows).toEqual([{ start: 2029, end: 2045, publications: ['Decanter'] }])
  })

  // Completeness filter must match deriveWineLevelFields exactly, or the UI
  // claims disagreement over citations the backend never counted.
  it('ignores half-open and absent windows', () => {
    const windows = getAttributedDrinkingWindows([
      review('jjbuckley', [
        score('Decanter', { start: 2029, end: 2045 }),
        score('Vinous', { start: 2026, end: null }),
        score('James Suckling', { start: null, end: 2040 }),
        score('Wine Spectator', null),
      ]),
    ])

    expect(windows).toEqual([{ start: 2029, end: 2045, publications: ['Decanter'] }])
  })

  it('returns a single entry when every critic agrees', () => {
    const windows = getAttributedDrinkingWindows([
      review('jjbuckley', [
        score('Decanter', { start: 2029, end: 2045 }),
        score('Vinous', { start: 2029, end: 2045 }),
      ]),
    ])

    expect(windows).toHaveLength(1)
    expect(windows[0].publications).toEqual(['Decanter', 'Vinous'])
  })
})
