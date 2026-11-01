// Phase 13 WI-3 — per-device bearer tokens on /api and a per-device cap on
// the metered routes. Uses the real createApp, so the metered paths are
// checked against the real routers; storage throws and the API keys are
// removed, so no handler can reach a database or a paid API.
import type { AddressInfo } from 'net'
import type { Server } from 'http'

jest.mock('../../modules/storage', () => ({
  getStorage: () => {
    throw new Error('storage is not available in this test')
  },
}))

import { createApp, optionsFromEnv, type AppOptions } from '../../app'
import { parseDeviceTokens } from '../../middleware/device-auth'
import { meteredLimitsFromEnv } from '../../middleware/metered-rate-limit'

const PHONE = 'p'.repeat(40)
const WEB = 'w'.repeat(40)
const REVOKED = 'r'.repeat(40)

const savedKeys = { openai: process.env.OPENAI_API_KEY, serper: process.env.SERPER_API_KEY }
beforeAll(() => {
  delete process.env.OPENAI_API_KEY
  delete process.env.SERPER_API_KEY
})
afterAll(() => {
  if (savedKeys.openai !== undefined) process.env.OPENAI_API_KEY = savedKeys.openai
  if (savedKeys.serper !== undefined) process.env.SERPER_API_KEY = savedKeys.serper
})

async function serve(opts: Partial<AppOptions>): Promise<{ base: string; close: () => Promise<void> }> {
  const app = createApp({ corsOrigins: ['http://localhost:5173'], ...opts })
  const server: Server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('parseDeviceTokens', () => {
  it('reads name:token pairs and treats unset as no devices', () => {
    expect(parseDeviceTokens(` phone:${PHONE} , web:${WEB} `)).toEqual([
      { name: 'phone', token: PHONE },
      { name: 'web', token: WEB },
    ])
    expect(parseDeviceTokens(undefined)).toEqual([])
    expect(parseDeviceTokens('')).toEqual([])
  })

  it('rejects malformed, short, duplicate-name and shared tokens without echoing a token', () => {
    expect(() => parseDeviceTokens(PHONE)).toThrow('name:token')
    expect(() => parseDeviceTokens('phone:short')).toThrow(/shorter than 32/)
    expect(() => parseDeviceTokens(`a:${PHONE},a:${WEB}`)).toThrow(/unique/)
    expect(() => parseDeviceTokens(`a:${PHONE},b:${PHONE}`)).toThrow(/own token/)
    try {
      parseDeviceTokens(`phone:${PHONE},broken`)
    } catch (err) {
      expect(String(err)).not.toContain(PHONE)
    }
  })
})

describe('optionsFromEnv', () => {
  it('refuses to start in production without device tokens', () => {
    expect(() => optionsFromEnv({ NODE_ENV: 'production' })).toThrow(/DEVICE_TOKENS/)
    expect(optionsFromEnv({ NODE_ENV: 'production', DEVICE_TOKENS: `phone:${PHONE}` }).deviceTokens).toHaveLength(1)
  })

  it('allows no tokens outside production (local development)', () => {
    expect(optionsFromEnv({}).deviceTokens).toEqual([])
  })

  it('reads metered limits, falling back to the defaults', () => {
    expect(meteredLimitsFromEnv({ METERED_LIMIT_PER_HOUR: '5', METERED_LIMIT_PER_DAY: '9' })).toEqual({ perHour: 5, perDay: 9 })
    expect(meteredLimitsFromEnv({ METERED_LIMIT_PER_HOUR: 'nope' })).toEqual({ perHour: 60, perDay: 200 })
  })
})

describe('with device tokens', () => {
  // The revoked device's pair has been removed from DEVICE_TOKENS.
  const deviceTokens = parseDeviceTokens(`phone:${PHONE},web:${WEB}`)
  let s: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    s = await serve({ deviceTokens, meteredLimits: { perHour: 3, perDay: 100 } })
  })
  afterAll(() => s.close())

  it('rejects a request with no token, a wrong token, a revoked token, or a malformed header', async () => {
    for (const headers of [{}, bearer('x'.repeat(40)), bearer(REVOKED), { Authorization: PHONE }, { Authorization: `Basic ${PHONE}` }]) {
      const res = await fetch(`${s.base}/api/settings`, { headers })
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBe('Bearer')
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    }
  })

  it('lets a listed token through (to the route, which here fails on storage)', async () => {
    const res = await fetch(`${s.base}/api/settings`, { headers: bearer(PHONE) })
    expect(res.status).toBe(500)
  })

  it('keeps /healthz open', async () => {
    const res = await fetch(`${s.base}/healthz`)
    expect(res.status).toBe(200)
  })

  it('answers a CORS preflight without a token', async () => {
    const res = await fetch(`${s.base}/api/wines`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    })
    expect(res.status).toBe(204)
  })

  it('caps every metered route per device, and leaves other devices and other routes alone', async () => {
    const metered: Array<[string, RequestInit]> = [
      ['/api/label-scan', { method: 'POST' }],
      ['/api/tasting-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
      ['/api/wines/w1/fetch-price', { method: 'POST' }],
      ['/api/wines/w1/fetch-reviews', { method: 'POST' }],
      ['/api/wines/w1/resolve-retailer-url', { method: 'POST' }],
      ['/api/wines/w1/confirm-retailer-link', { method: 'POST' }],
    ]
    const call = (path: string, init: RequestInit, token: string) =>
      fetch(`${s.base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), ...bearer(token) } })

    // Limit is 3 an hour: the phone's first three metered calls pass the limiter…
    for (const [path, init] of metered.slice(0, 3)) {
      expect((await call(path, init, PHONE)).status).not.toBe(429)
    }
    // …and every metered route refuses the phone from then on.
    for (const [path, init] of metered) {
      const res = await call(path, init, PHONE)
      expect(res.status).toBe(429)
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(((await res.json()) as { error: string }).error).toBe('rate_limited')
    }
    // A read is not metered.
    expect((await call('/api/wines', { method: 'GET' }, PHONE)).status).not.toBe(429)
    // The web token has its own budget.
    expect((await call('/api/wines/w1/fetch-price', { method: 'POST' }, WEB)).status).not.toBe(429)
  })
})

describe('without device tokens (local development)', () => {
  let s: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    s = await serve({ deviceTokens: [], meteredLimits: { perHour: 1, perDay: 1 } })
  })
  afterAll(() => s.close())

  it('needs no token and applies no metered limit', async () => {
    expect((await fetch(`${s.base}/api/settings`)).status).toBe(500)
    for (let i = 0; i < 3; i++) {
      expect((await fetch(`${s.base}/api/wines/w1/fetch-price`, { method: 'POST' })).status).not.toBe(429)
    }
  })
})
