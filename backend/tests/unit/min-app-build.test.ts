// Phase 13 WI-8 — the backend refuses an iPhone build older than
// MIN_IOS_BUILD with 426. Uses the real createApp, like device-auth.test.ts:
// storage throws and the API keys are removed, so a request that gets past
// the check reaches a route that fails on storage (500), never a paid API.
import type { AddressInfo } from 'net'
import type { Server } from 'http'

jest.mock('../../modules/storage', () => ({
  getStorage: () => {
    throw new Error('storage is not available in this test')
  },
}))

import { createApp, optionsFromEnv, type AppOptions } from '../../app'
import { parseDeviceTokens } from '../../middleware/device-auth'
import { minIosBuildFromEnv } from '../../middleware/min-app-build'

const PHONE = 'p'.repeat(40)

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

const build = (n: string) => ({ 'X-App-Build': n })
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('minIosBuildFromEnv', () => {
  it('treats unset or empty as no check', () => {
    expect(minIosBuildFromEnv(undefined)).toBeNull()
    expect(minIosBuildFromEnv('')).toBeNull()
    expect(minIosBuildFromEnv('  ')).toBeNull()
  })

  it('reads a positive whole number', () => {
    expect(minIosBuildFromEnv('12')).toBe(12)
    expect(minIosBuildFromEnv(' 7 ')).toBe(7)
  })

  it('refuses anything else at start', () => {
    for (const bad of ['0', '-3', '1.5', 'abc', '12a']) {
      expect(() => minIosBuildFromEnv(bad)).toThrow(/MIN_IOS_BUILD/)
    }
  })

  it('is read by optionsFromEnv', () => {
    expect(optionsFromEnv({ MIN_IOS_BUILD: '5' }).minIosBuild).toBe(5)
    expect(optionsFromEnv({}).minIosBuild).toBeNull()
  })
})

describe('with a minimum build (no device tokens)', () => {
  let s: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    s = await serve({ deviceTokens: [], minIosBuild: 10 })
  })
  afterAll(() => s.close())

  it('answers 426 with the minimum build to an older app', async () => {
    for (const headers of [build('9'), build('1'), build('0')]) {
      const res = await fetch(`${s.base}/api/settings`, { headers })
      expect(res.status).toBe(426)
      expect(await res.json()).toEqual({ error: 'update_required', min_build: 10 })
    }
  })

  it('refuses a build header that is not a whole number', async () => {
    for (const headers of [build('abc'), build('10.1'), build(''), build('-12')]) {
      expect((await fetch(`${s.base}/api/settings`, { headers })).status).toBe(426)
    }
  })

  it('serves the minimum build and newer', async () => {
    for (const headers of [build('10'), build(' 11 '), build('300')]) {
      expect((await fetch(`${s.base}/api/settings`, { headers })).status).toBe(500)
    }
  })

  it('never refuses a request without the header (web app, curl)', async () => {
    expect((await fetch(`${s.base}/api/settings`)).status).toBe(500)
  })

  it('leaves /healthz open to an old app', async () => {
    expect((await fetch(`${s.base}/healthz`, { headers: build('1') })).status).toBe(200)
  })
})

describe('with a minimum build and device tokens', () => {
  let s: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    s = await serve({
      deviceTokens: parseDeviceTokens(`phone:${PHONE}`),
      meteredLimits: { perHour: 1, perDay: 100 },
      minIosBuild: 10,
    })
  })
  afterAll(() => s.close())

  it('checks the token first: an unknown caller gets 401, not 426', async () => {
    const res = await fetch(`${s.base}/api/settings`, { headers: build('1') })
    expect(res.status).toBe(401)
  })

  it('refuses an old build before it spends the device’s metered budget', async () => {
    const old = { ...bearer(PHONE), ...build('9') }
    for (let i = 0; i < 3; i++) {
      expect((await fetch(`${s.base}/api/wines/w1/fetch-price`, { method: 'POST', headers: old })).status).toBe(426)
    }
    // The limit is 1 an hour, so the current build's first metered call still passes the limiter.
    const current = { ...bearer(PHONE), ...build('10') }
    expect((await fetch(`${s.base}/api/wines/w1/fetch-price`, { method: 'POST', headers: current })).status).not.toBe(429)
    expect((await fetch(`${s.base}/api/wines/w1/fetch-price`, { method: 'POST', headers: current })).status).toBe(429)
  })
})

describe('without a minimum build', () => {
  let s: Awaited<ReturnType<typeof serve>>
  beforeAll(async () => {
    s = await serve({ deviceTokens: [], minIosBuild: null })
  })
  afterAll(() => s.close())

  it('serves every build', async () => {
    expect((await fetch(`${s.base}/api/settings`, { headers: build('1') })).status).toBe(500)
    expect((await fetch(`${s.base}/api/settings`, { headers: build('junk') })).status).toBe(500)
  })
})
