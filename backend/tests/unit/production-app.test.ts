// Phase 13 WI-1 — the production shape of the Express app: /healthz never
// touches the database, CORS comes from an allowlist, and the same process
// serves the built web app without swallowing /api.
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import type { Server } from 'http'

const getStorage = jest.fn(() => {
  throw new Error('the database must not be opened')
})
jest.mock('../../modules/storage', () => ({ getStorage }))

import { createApp, corsOriginsFromEnv } from '../../app'

let webDir: string
let server: Server
let base: string

beforeAll(async () => {
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wine-web-'))
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Wine</title>')
  fs.mkdirSync(path.join(webDir, 'assets'))
  fs.writeFileSync(path.join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)')

  const app = createApp({ corsOrigins: ['https://allowed.example'], webDistDir: webDir })
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(webDir, { recursive: true, force: true })
})

describe('/healthz', () => {
  it('answers ok without opening the database', async () => {
    const res = await fetch(`${base}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(getStorage).not.toHaveBeenCalled()
  })
})

describe('CORS allowlist', () => {
  it('echoes an allowed origin and omits the header for any other', async () => {
    const ok = await fetch(`${base}/api/nope`, { headers: { Origin: 'https://allowed.example' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://allowed.example')
    const other = await fetch(`${base}/api/nope`, { headers: { Origin: 'https://elsewhere.example' } })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('parses CORS_ORIGINS and falls back to the Vite dev origin', () => {
    expect(corsOriginsFromEnv(' https://a.example , https://b.example ,')).toEqual(['https://a.example', 'https://b.example'])
    expect(corsOriginsFromEnv('')).toEqual(['http://localhost:5173'])
    expect(corsOriginsFromEnv(undefined)).toEqual(['http://localhost:5173'])
  })
})

describe('serving the web app', () => {
  it('serves index.html, uncached, for the root and any non-API path', async () => {
    for (const p of ['/', '/cellar/some-wine']) {
      const res = await fetch(`${base}${p}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(await res.text()).toContain('<title>Wine</title>')
    }
  })

  it('caches fingerprinted assets for good', async () => {
    const res = await fetch(`${base}/assets/index-abc123.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('never answers an unknown /api path with the HTML page', async () => {
    for (const p of ['/api/nope', '/api']) {
      const res = await fetch(`${base}${p}`)
      expect(res.status).toBe(404)
      expect(await res.text()).not.toContain('<title>Wine</title>')
    }
  })

  it('refuses to start without a built index.html', () => {
    expect(() => createApp({ corsOrigins: [], webDistDir: path.join(webDir, 'missing') })).toThrow(/index\.html/)
  })
})
