import {
  findProbeEntry,
  mergeProbeLog,
  shouldSkipProbedRetailer,
  NEGATIVE_PROBE_TTL_DAYS,
} from './probe-log'
import type { ReviewProbeLogEntry } from '@shared/types'

const NOW = new Date('2026-08-12T12:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function entry(overrides: Partial<ReviewProbeLogEntry> = {}): ReviewProbeLogEntry {
  return {
    slug: 'sokolin',
    domain: 'sokolin.com',
    stage: 'zero_results',
    variants_tried: 3,
    probed_at: daysAgo(10),
    ...overrides,
  }
}

describe('shouldSkipProbedRetailer', () => {
  it('skips a fresh zero_results probe', () => {
    expect(shouldSkipProbedRetailer(entry({ stage: 'zero_results', probed_at: daysAgo(10) }), NOW)).toBe(true)
  })

  it('does not skip once the probe has aged past the TTL', () => {
    expect(
      shouldSkipProbedRetailer(
        entry({ stage: 'zero_results', probed_at: daysAgo(NEGATIVE_PROBE_TTL_DAYS + 1) }),
        NOW
      )
    ).toBe(false)
  })

  it('does not skip on the TTL boundary itself', () => {
    expect(
      shouldSkipProbedRetailer(entry({ stage: 'zero_results', probed_at: daysAgo(NEGATIVE_PROBE_TTL_DAYS) }), NOW)
    ).toBe(false)
  })

  // Results existed here, and Phase 9.1's ranking may now pick differently —
  // this is the one stage that changed meaning under a matcher fix.
  it('never skips on no_relevant_match', () => {
    expect(shouldSkipProbedRetailer(entry({ stage: 'no_relevant_match' }), NOW)).toBe(false)
  })

  // The one rule this whole file exists to protect: a transient failure must
  // never be read as "we checked and there was nothing" — that conflation
  // erased eight wines' review_data on 2026-08-05.
  it('never skips on request_failed, regardless of how recent', () => {
    expect(shouldSkipProbedRetailer(entry({ stage: 'request_failed', probed_at: daysAgo(1) }), NOW)).toBe(false)
  })

  it('never skips a page that was actually found', () => {
    expect(shouldSkipProbedRetailer(entry({ stage: 'found', probed_at: daysAgo(1) }), NOW)).toBe(false)
  })

  it('does not skip when there is no prior probe at all', () => {
    expect(shouldSkipProbedRetailer(undefined, NOW)).toBe(false)
  })

  it('does not skip an unparseable timestamp', () => {
    expect(shouldSkipProbedRetailer(entry({ probed_at: 'not-a-date' }), NOW)).toBe(false)
  })
})

describe('findProbeEntry', () => {
  it('finds the entry for a given slug', () => {
    const log = [entry({ slug: 'sokolin' }), entry({ slug: 'morrell' })]
    expect(findProbeEntry(log, 'morrell')?.slug).toBe('morrell')
  })

  it('returns undefined for an absent or null log', () => {
    expect(findProbeEntry(null, 'sokolin')).toBeUndefined()
    expect(findProbeEntry(undefined, 'sokolin')).toBeUndefined()
    expect(findProbeEntry([], 'sokolin')).toBeUndefined()
  })
})

describe('mergeProbeLog', () => {
  it('overwrites a slug this run actually probed', () => {
    const existing = [entry({ slug: 'sokolin', stage: 'zero_results' })]
    const fresh = [entry({ slug: 'sokolin', stage: 'found', probed_at: daysAgo(0) })]

    const merged = mergeProbeLog(existing, fresh)

    expect(merged).toHaveLength(1)
    expect(merged[0].stage).toBe('found')
  })

  // A retailer skipped this run — by a still-valid negative probe, or an
  // extended-tier retailer never reached because the primary tier already
  // scored — must keep its history rather than losing it.
  it('keeps an existing entry for a retailer this run did not touch', () => {
    const existing = [entry({ slug: 'sokolin' }), entry({ slug: 'morrell', stage: 'found' })]
    const fresh = [entry({ slug: 'sokolin', stage: 'zero_results', probed_at: daysAgo(0) })]

    const merged = mergeProbeLog(existing, fresh)

    expect(merged.find(e => e.slug === 'morrell')).toEqual(existing[1])
  })

  it('adds a slug with no prior history', () => {
    const merged = mergeProbeLog([], [entry({ slug: 'jjbuckley' })])
    expect(merged.map(e => e.slug)).toEqual(['jjbuckley'])
  })

  it('treats a null existing log the same as an empty one', () => {
    const fresh = [entry({ slug: 'kl' })]
    expect(mergeProbeLog(null, fresh)).toEqual(fresh)
  })
})
