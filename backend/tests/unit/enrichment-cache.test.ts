import {
  coalesce,
  inFlightCount,
  isWithinTtl,
  newestTimestamp,
  PRICE_TTL_DAYS,
  reachedExtendedTier,
  REVIEWS_TTL_DAYS,
} from '../../routes/enrichment-cache'
import type { ReviewProbeLogEntry } from '@shared/types'

function probeEntry(slug: string, overrides: Partial<ReviewProbeLogEntry> = {}): ReviewProbeLogEntry {
  return { slug, domain: `${slug}.example.com`, stage: 'zero_results', variants_tried: 3, probed_at: '2026-08-12T00:00:00.000Z', ...overrides }
}

const NOW = new Date('2026-08-12T12:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('isWithinTtl', () => {
  it('treats data fetched inside the window as current', () => {
    expect(isWithinTtl(daysAgo(3), PRICE_TTL_DAYS, NOW)).toBe(true)
  })

  it('treats data older than the window as stale', () => {
    expect(isWithinTtl(daysAgo(8), PRICE_TTL_DAYS, NOW)).toBe(false)
  })

  // Prices move; a critic score published against a vintage does not. The two
  // numbers differ because they are different kinds of fact.
  it('keeps reviews current far longer than prices', () => {
    const twoWeeks = daysAgo(14)
    expect(isWithinTtl(twoWeeks, PRICE_TTL_DAYS, NOW)).toBe(false)
    expect(isWithinTtl(twoWeeks, REVIEWS_TTL_DAYS, NOW)).toBe(true)
  })

  // "We have no idea when this was fetched" must fall through to fetching,
  // never to trusting it.
  it.each([[null], [undefined], ['not a date']])('is never fresh for %p', (value) => {
    expect(isWithinTtl(value as string | null | undefined, PRICE_TTL_DAYS, NOW)).toBe(false)
  })
})

describe('newestTimestamp', () => {
  it('takes the most recent of several per-retailer timestamps', () => {
    expect(newestTimestamp([daysAgo(40), daysAgo(2), daysAgo(19)])).toBe(daysAgo(2))
  })

  it('ignores absent and unparseable entries rather than failing on them', () => {
    expect(newestTimestamp([null, 'garbage', undefined, daysAgo(5)])).toBe(daysAgo(5))
  })

  // A wine whose review sourcing ran and found nothing has no timestamps at
  // all, so it stays stale and re-runs. WI-5's probe log is what stops that
  // re-run from costing a full ladder.
  it('returns null when there is nothing to date', () => {
    expect(newestTimestamp([])).toBeNull()
    expect(newestTimestamp([null, undefined])).toBeNull()
  })
})

describe('coalesce', () => {
  // The saving a TTL cannot make: at the moment the second click lands, the
  // first run has written nothing yet, so there is no fetched_at to check.
  it('joins a second request onto the run already in flight', async () => {
    let runs = 0
    let release: (value: string) => void = () => {}
    const work = () => {
      runs += 1
      return new Promise<string>((resolve) => {
        release = resolve
      })
    }

    const first = coalesce('wine-1:fetch-reviews', work)
    const second = coalesce('wine-1:fetch-reviews', work)
    release('done')

    expect(await first).toBe('done')
    expect(await second).toBe('done')
    expect(runs).toBe(1)
  })

  it('does not conflate two actions on the same wine, or the same action on two wines', async () => {
    let runs = 0
    const work = async () => {
      runs += 1
      return runs
    }

    await Promise.all([
      coalesce('wine-1:fetch-price', work),
      coalesce('wine-1:fetch-reviews', work),
      coalesce('wine-2:fetch-price', work),
    ])

    expect(runs).toBe(3)
  })

  it('releases the key once the run settles, so a later click still works', async () => {
    let runs = 0
    const work = async () => {
      runs += 1
      return runs
    }

    await coalesce('wine-3:fetch-price', work)
    await coalesce('wine-3:fetch-price', work)

    expect(runs).toBe(2)
    expect(inFlightCount()).toBe(0)
  })

  // A key left behind by a thrown run would wedge that wine forever: every
  // later click would await an already-rejected promise.
  it('releases the key when the run throws, and shares the failure with joiners', async () => {
    const work = async () => {
      throw new Error('serper exploded')
    }

    const first = coalesce('wine-4:fetch-price', work)
    const second = coalesce('wine-4:fetch-price', work)

    await expect(first).rejects.toThrow('serper exploded')
    await expect(second).rejects.toThrow('serper exploded')
    expect(inFlightCount()).toBe(0)
  })
})

// Phase 9.4, WI-5
describe('reachedExtendedTier', () => {
  it('is false with no probe log', () => {
    expect(reachedExtendedTier(null)).toBe(false)
    expect(reachedExtendedTier(undefined)).toBe(false)
    expect(reachedExtendedTier([])).toBe(false)
  })

  it('is false when only primary-tier retailers were probed', () => {
    // 'kl' is a primary-tier slug (shared/config/retailers.config.ts).
    expect(reachedExtendedTier([probeEntry('kl')])).toBe(false)
  })

  it('is true once an extended-tier retailer was probed', () => {
    // 'zachys' is an extended-tier slug.
    expect(reachedExtendedTier([probeEntry('kl'), probeEntry('zachys', { stage: 'found' })])).toBe(true)
  })

  it('is false for an unrecognized slug (not in RETAILER_CONFIG)', () => {
    expect(reachedExtendedTier([probeEntry('fallback-someshop-com')])).toBe(false)
  })
})
