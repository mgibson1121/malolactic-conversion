import express from 'express'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import type { WineEntry } from '@shared/types'

const listWines = jest.fn()
jest.mock('../../modules/storage', () => ({ getStorage: () => ({ listWines }) }))

import winesRouter from '../../routes/wines'

const EXISTING = {
  id: 'wine-1',
  producer: 'Domaine Leroy',
  denomination: 'Gevrey-Chambertin',
  vintage: 2019,
  quality_classification: null,
  vineyard: null,
  cuvee: null,
} as WineEntry

let server: Server
let base: string

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/wines', winesRouter)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/wines`
})

afterAll(() => new Promise((resolve) => server.close(resolve)))

function check(body: unknown) {
  return fetch(`${base}/duplicate-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/wines/duplicate-check (Phase 12)', () => {
  it('returns the matching wine for a confident duplicate, checked against promoted wines only', async () => {
    listWines.mockResolvedValue([EXISTING])
    const res = await check({ producer: 'Domaine Leroy', denomination: 'Gevrey-Chambertin', vintage: 2019 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: 'duplicate', wine: EXISTING })
    // No filter → the storage default, which excludes drafts.
    expect(listWines).toHaveBeenCalledWith()
  })

  it('reports a vintage mismatch as distinct from a duplicate', async () => {
    listWines.mockResolvedValue([EXISTING])
    const res = await check({ producer: 'Domaine Leroy', denomination: 'Gevrey-Chambertin', vintage: 2021 })
    expect(await res.json()).toEqual({ kind: 'vintage_mismatch', wine: EXISTING })
  })

  it('accepts a full label-scan result and ignores the fields it does not read', async () => {
    listWines.mockResolvedValue([EXISTING])
    const res = await check({
      producer: 'Domaine Rousseau', denomination: 'Gevrey-Chambertin', vintage: 2019,
      region: 'Burgundy', missing_tier1_fields: [], raw_response: '{}',
    })
    expect(await res.json()).toEqual({ kind: 'none' })
  })

  it('treats absent identity fields as null rather than rejecting', async () => {
    listWines.mockResolvedValue([EXISTING])
    const res = await check({})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: 'none' })
  })

  it('rejects a malformed vintage with 400', async () => {
    const res = await check({ producer: 'Domaine Leroy', vintage: 'twenty-nineteen' })
    expect(res.status).toBe(400)
    expect(listWines).not.toHaveBeenCalled()
  })
})
