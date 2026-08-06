/**
 * Runs the 2026-08-04 ground-truth fixture against the matcher and the
 * URL-shape guard (Phase 9.1, WI-10).
 *
 * Offline and cheap — no Serper, no Puppeteer, no GPT-4o — so it runs in CI
 * on every push, unlike backend/scripts/validate-reviews.ts, which exercises
 * the same fixture against the live pipeline and costs real API usage.
 *
 * The point of the pairing: KNOWN_BAD alone can be satisfied by rejecting
 * everything, and KNOWN_GOOD alone by accepting everything. Both together
 * pin the boundary.
 */
import { scoreMatch, isAcceptableMatch } from '@shared/utils/wine-match'
import { isNonProductUrl } from '@shared/config/denylisted-domains'
import { BATCH_WINES, KNOWN_GOOD, KNOWN_BAD } from '../fixtures/ground-truth-wines'

describe('ground truth — the 2026-08-04 batch', () => {
  it('covers all 14 wines', () => {
    expect(BATCH_WINES).toHaveLength(14)
  })

  describe('KNOWN_GOOD — results that were right and must stay accepted', () => {
    it.each(KNOWN_GOOD.map(c => [c.what, c] as const))('%s', (_what, testCase) => {
      // A URL-shape rejection would make the match question moot.
      if (testCase.candidate.url) {
        expect(isNonProductUrl(testCase.candidate.url)).toBe(false)
      }

      const verdict = scoreMatch(testCase.candidate, testCase.wine)
      expect(verdict.producer).toBe('match')
      expect(isAcceptableMatch(verdict)).toBe(true)

      if (testCase.expectedVintageGap !== undefined) {
        expect(verdict.vintageGap).toBe(testCase.expectedVintageGap)
      }
    })

    it('accepts a wrong-vintage page rather than dropping it, and records the gap', () => {
      // Vintage ranks and labels; it never rejects. A shop whose only page
      // for a wine is two years off must still yield that page.
      const nearMiss = KNOWN_GOOD.find(c => (c.expectedVintageGap ?? 0) > 0)
      expect(nearMiss).toBeDefined()

      const verdict = scoreMatch(nearMiss!.candidate, nearMiss!.wine)
      expect(verdict.vintage).toBe('mismatch')
      expect(isAcceptableMatch(verdict)).toBe(true)
    })
  })

  describe('KNOWN_BAD — results that were stored wrongly and must never come back', () => {
    it.each(KNOWN_BAD.map(c => [c.what, c] as const))('%s', (_what, testCase) => {
      if (testCase.disqualifiedBy === 'url_shape') {
        expect(isNonProductUrl(testCase.candidate.url!)).toBe(true)
        return
      }

      const verdict = scoreMatch(testCase.candidate, testCase.wine)
      expect(isAcceptableMatch(verdict)).toBe(false)
      // Not just rejected — rejected for the recorded reason, so a
      // regression here says which rule broke.
      expect(verdict[testCase.disqualifiedBy!]).not.toBe('match')
    })
  })
})
