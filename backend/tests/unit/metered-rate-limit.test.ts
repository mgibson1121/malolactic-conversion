// Phase 13 WI-3 — the per-device metered limit's hourly and daily windows,
// driven by an injected clock.
import type { Request, Response } from 'express'
import { meteredRateLimit } from '../../middleware/metered-rate-limit'

const HOUR = 60 * 60 * 1000

function harness(perHour: number, perDay: number) {
  let t = 1_000_000_000_000
  const limit = meteredRateLimit({ perHour, perDay }, () => t)
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  function call(device = 'phone') {
    const headers: Record<string, string> = {}
    let status = 200
    let passed = false
    const res = {
      locals: { device },
      setHeader: (k: string, v: string) => (headers[k] = v),
      status: (s: number) => ((status = s), res),
      json: () => res,
    } as unknown as Response
    limit({ method: 'POST', path: '/x' } as Request, res, () => (passed = true))
    return { passed, status, retryAfter: Number(headers['Retry-After'] ?? 0) }
  }
  return { call, advance: (ms: number) => (t += ms), restore: () => warn.mockRestore() }
}

it('allows perHour calls, then refuses until the oldest one is an hour old', () => {
  const h = harness(2, 100)
  expect(h.call().passed).toBe(true)
  h.advance(10 * 60 * 1000)
  expect(h.call().passed).toBe(true)
  const refused = h.call()
  expect(refused).toMatchObject({ passed: false, status: 429 })
  expect(refused.retryAfter).toBe(50 * 60) // the first call ages out in 50 minutes
  h.advance(50 * 60 * 1000 + 1)
  expect(h.call().passed).toBe(true)
  h.restore()
})

it('refused calls do not count against the budget', () => {
  const h = harness(1, 100)
  h.call()
  for (let i = 0; i < 5; i++) h.call()
  h.advance(HOUR + 1)
  expect(h.call().passed).toBe(true)
  h.restore()
})

it('applies the daily cap across hours', () => {
  const h = harness(10, 3)
  for (let i = 0; i < 3; i++) {
    expect(h.call().passed).toBe(true)
    h.advance(2 * HOUR)
  }
  const refused = h.call()
  expect(refused.passed).toBe(false)
  expect(refused.retryAfter).toBe(18 * 60 * 60) // the first call is 6h old
  h.restore()
})

it('keeps each device separate', () => {
  const h = harness(1, 1)
  expect(h.call('phone').passed).toBe(true)
  expect(h.call('phone').passed).toBe(false)
  expect(h.call('household').passed).toBe(true)
  h.restore()
})
