import fs from 'fs'
import path from 'path'
import {
  serperFetch,
  accountSerperUsage,
  recordAvoidedCalls,
  getLifetimeUsage,
  resetLifetimeUsage,
} from '@shared/utils/serper-client'

const originalFetch = global.fetch

function jsonResponse(status = 200): Response {
  return new Response(JSON.stringify({ organic: [] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  resetLifetimeUsage()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('serperFetch accounting', () => {
  it('records one call and one attempt for a request that succeeds first time', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse())

    const usage = await captureUsage(async () => {
      await serperFetch('search', { q: 'test' }, 'key', 'reviews:primary:benchmark')
    })

    expect(usage.calls).toBe(1)
    expect(usage.attempts).toBe(1)
    expect(usage.failed).toBe(0)
    expect(usage.by_label['reviews:primary:benchmark']).toEqual({
      calls: 1,
      attempts: 1,
      failed: 0,
      avoided: 0,
    })
  })

  // The whole reason WI-1 extends fetchWithRetry rather than counting one per
  // wrapper call: a 429 storm is both the most expensive outcome and the one
  // a per-call counter under-reports by 3×.
  it('bills every retry a rate limit triggers, not just the logical call', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(429))

    const usage = await captureUsage(async () => {
      await serperFetch('search', { q: 'test' }, 'key', 'reviews:primary:kl')
    })

    expect(usage.calls).toBe(1)
    expect(usage.attempts).toBe(3)
    expect(usage.failed).toBe(1)
  })

  it('still records the attempts a thrown request already spent', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'))

    const usage = await captureUsage(async () => {
      await expect(serperFetch('shopping', { q: 'test' }, 'key', 'price:shopping')).rejects.toThrow()
    })

    expect(usage.attempts).toBe(3)
    expect(usage.failed).toBe(1)
  })

  it('sends the endpoint, key and body Serper expects', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse())

    await serperFetch('shopping', { q: 'Rousseau wine', gl: 'us' }, 'secret-key', 'price:shopping')

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://google.serper.dev/shopping')
    expect((init?.headers as Record<string, string>)['X-API-KEY']).toBe('secret-key')
    expect(JSON.parse(String(init?.body))).toEqual({ q: 'Rousseau wine', gl: 'us' })
  })

  it('counts avoided calls separately from billed attempts', async () => {
    const usage = await captureUsage(async () => {
      recordAvoidedCalls('reviews:skipped:unrenderable:kl', 4)
    })

    expect(usage.attempts).toBe(0)
    expect(usage.avoided).toBe(4)
    expect(usage.by_label['reviews:skipped:unrenderable:kl'].avoided).toBe(4)
  })

  it('keeps one wine\'s enrichment separate from another\'s while both feed the lifetime total', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse())

    const first = await captureUsage(async () => {
      await serperFetch('search', { q: 'a' }, 'key', 'reviews:primary:benchmark')
    })
    const second = await captureUsage(async () => {
      await serperFetch('search', { q: 'b' }, 'key', 'reviews:primary:benchmark')
      await serperFetch('search', { q: 'c' }, 'key', 'reviews:extended:sokolin')
    })

    expect(first.calls).toBe(1)
    expect(second.calls).toBe(2)
    expect(getLifetimeUsage().calls).toBe(3)
  })

  it('logs one structured line per accounted request, even when it throws', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse())

    await expect(
      accountSerperUsage({ wine_id: 'wine-1', action: 'fetch-reviews' }, async () => {
        await serperFetch('search', { q: 'a' }, 'key', 'reviews:primary:benchmark')
        throw new Error('render blew up')
      })
    ).rejects.toThrow('render blew up')

    expect(log).toHaveBeenCalledTimes(1)
    const logged = JSON.parse(String(log.mock.calls[0][0]).replace('[serper] ', ''))
    expect(logged.wine_id).toBe('wine-1')
    expect(logged.action).toBe('fetch-reviews')
    expect(logged.attempts).toBe(1)
  })
})

/**
 * Every Serper request must go through serper-client.ts (Phase 9.2, WI-1).
 *
 * This is a grep, not a type constraint, because there is nothing in the type
 * system stopping the next call site from being a bare `fetch` — which is
 * exactly how the repo came to hold an unaccounted third spender
 * (backend/scripts/tmp-serper-health.ts) while the budget was believed
 * measured. An unaccounted call is worse than an expensive one: it makes the
 * measurement lie.
 */
describe('no unaccounted Serper call sites', () => {
  const ROOT = path.resolve(__dirname, '../../..')
  const SCANNED_DIRS = ['backend/modules', 'backend/routes', 'backend/scripts', 'shared']
  const ALLOWED = [path.join('shared', 'utils', 'serper-client.ts')]

  function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.isFile() && full.endsWith('.ts') ? [full] : []
    })
  }

  it('mentions google.serper.dev only inside serper-client.ts', () => {
    const offenders = SCANNED_DIRS.flatMap(d => walk(path.join(ROOT, d)))
      .map(f => path.relative(ROOT, f))
      .filter(f => !f.endsWith('.test.ts'))
      .filter(f => !ALLOWED.includes(f))
      .filter(f => fs.readFileSync(path.join(ROOT, f), 'utf-8').includes('google.serper.dev'))

    expect(offenders).toEqual([])
  })
})

/** Runs `fn` inside an accounting scope and returns what it spent. */
async function captureUsage(fn: () => Promise<void>) {
  const before = getLifetimeUsage()
  await accountSerperUsage({ wine_id: 'test-wine', action: 'test' }, fn)
  const after = getLifetimeUsage()
  return {
    calls: after.calls - before.calls,
    attempts: after.attempts - before.attempts,
    failed: after.failed - before.failed,
    avoided: after.avoided - before.avoided,
    by_label: after.by_label,
  }
}
