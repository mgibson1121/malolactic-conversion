import { windowStatusOf } from '@shared/utils/window-status'
import { review, score } from '../helpers/review-fixtures'

const WINDOW = { start: '2028-01-01', end: '2040-01-01' }

describe('windowStatusOf (Phase 12.1 WI-2)', () => {
  it('is primary when the wine has a wine-level window, whatever the critics say', () => {
    const disagreeing = [
      review('a', 2019, [score('Vinous', 93, { window: [2025, 2035] })]),
      review('b', 2019, [score('Burghound', 91, { window: [2030, 2045] })]),
    ]
    expect(windowStatusOf(WINDOW, disagreeing)).toBe('primary')
    expect(windowStatusOf(WINDOW, null)).toBe('primary')
  })

  it('is check when there is no window and two critics disagree', () => {
    const rd = [
      review('a', 2019, [score('Vinous', 93, { window: [2025, 2035] })]),
      review('b', 2019, [score('Burghound', 91, { window: [2030, 2045] })]),
    ]
    expect(windowStatusOf(null, rd)).toBe('check')
  })

  it('is none when there are no critic windows at all', () => {
    expect(windowStatusOf(null, null)).toBe('none')
    expect(windowStatusOf(null, [])).toBe('none')
    expect(windowStatusOf(null, [review('a', 2019, [score('Vinous', 93)])])).toBe('none')
  })

  it('never calls a single critic check — that is a derived primary window', () => {
    const rd = [review('a', 2019, [score('Vinous', 93, { window: [2025, 2035] })])]
    expect(windowStatusOf(null, rd)).toBe('none')
  })

  it('does not call agreeing critics check, even syndicated across retailers', () => {
    const rd = [
      review('a', 2019, [score('Vinous', 93, { window: [2025, 2035] })]),
      review('b', 2019, [score('Burghound', 91, { window: [2025, 2035] })]),
    ]
    expect(windowStatusOf(null, rd)).toBe('none')
  })

  it('counts one vote per publication, so one critic syndicated twice never disagrees with itself', () => {
    const rd = [
      review('a', 2019, [score('Vinous', 93, { window: [2025, 2035] })]),
      review('b', 2019, [score('Vinous', 93, { window: [2026, 2036] })]),
    ]
    expect(windowStatusOf(null, rd)).toBe('none')
  })

  it('ignores pages that are not confirmed to be this vintage, as derivation does', () => {
    const rd = [
      review('a', 2019, [score('Vinous', 93, { window: [2025, 2035] })]),
      review('b', 2017, [score('Burghound', 91, { window: [2030, 2045] })], 'mismatch'),
      review('c', null, [score('Decanter', 90, { window: [2031, 2046] })], 'unknown'),
    ]
    expect(windowStatusOf(null, rd)).toBe('none')
  })

  it('ignores half-open windows', () => {
    const half = score('Burghound', 91)
    half.drinking_window = { start: 2030, end: null }
    const rd = [review('a', 2019, [score('Vinous', 93, { window: [2025, 2035] })]), review('b', 2019, [half])]
    expect(windowStatusOf(null, rd)).toBe('none')
  })
})
