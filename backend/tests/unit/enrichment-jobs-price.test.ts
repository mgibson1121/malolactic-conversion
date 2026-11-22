/**
 * Phase 14 (WI-5): a price lookup is a job, like the review search — one per
 * wine, recorded in `wines.enrichment_job.price`, joined by a request that
 * arrives while it runs, cancelled by a discard or an identity edit.
 */
import express from 'express'
import Database from 'better-sqlite3'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { SQLiteAdapter } from '../../modules/storage/sqlite-adapter'
import type { CreateWineInput, EnrichmentJobs } from '@shared/types'
import { identityKey } from '@shared/utils/wine-match'
import { review, score } from '../helpers/review-fixtures'

let storage: SQLiteAdapter
jest.mock('../../modules/storage', () => ({ getStorage: () => storage }))

const mockFetchPriceData = jest.fn()
const mockFetchReviewData = jest.fn()
jest.mock('../../modules/price', () => ({
  fetchPriceData: (...args: unknown[]) => mockFetchPriceData(...args),
  aggregatePriceData: jest.requireActual('../../modules/price').aggregatePriceData,
}))
jest.mock('../../modules/reviews', () => ({
  fetchReviewData: (...args: unknown[]) => mockFetchReviewData(...args),
}))

import winesRouter from '../../routes/wines'
import { activeJobCount } from '../../routes/enrichment-jobs'

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
beforeEach(() => {
  storage = new SQLiteAdapter(new Database(':memory:'))
  mockFetchPriceData.mockReset()
  mockFetchReviewData.mockReset()
})
afterEach(() => {
  delete process.env.ENRICHMENT_HEARTBEAT_MS
})

const WINE: CreateWineInput = {
  producer: 'Marcoux', vintage: 2019, region: 'Rhône', denomination: 'Châteauneuf-du-Pape',
  grape_varieties: null, label_image_url: null,
  tag_discovered: true, tag_wishlist: false, tag_cellar: false, tag_consumed: false,
  cellar_quantity: 0, cellar_category: null, drinking_window: null,
  vintage_rating: null, my_rating: null, my_tags: [], wishlist_notes: null,
  price_paid: null, purchased_from: null, date_first_consumed: null,
  quality_classification: null, vineyard: null, cuvee: null, wine_color: 'red',
}

const listing = (slug: string, price: number) => ({
  slug, name: slug, price, url: `https://example.com/${slug}`, is_preferred_retailer: false, distance_miles: 0,
  is_search_results_page: true, matched_vintage: 2019, vintage_mismatch: false, vintage_verdict: 'match',
  pack_quantity: 1, bottle_size_ml: null, non_standard_format: false, format_label: '', link_only: false, verification: 'unverified',
})

/** A price run the test finishes by hand. */
function controlledRun() {
  let finish!: (value: unknown) => void
  let begun!: () => void
  const started = new Promise<void>((resolve) => (begun = resolve))
  const result = new Promise<unknown>((resolve) => (finish = resolve))
  mockFetchPriceData.mockImplementationOnce(() => {
    begun()
    return result
  })
  return { started, finish }
}
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

const post = (id: string, query = '') => fetch(`${base}/${id}/fetch-price${query}`, { method: 'POST' })
const patch = (id: string, body: unknown) =>
  fetch(`${base}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const stored = async (id: string) => (await storage.getWine(id))!
const priceJob = async (id: string) => (await stored(id)).enrichment_job?.price

describe('the price lookup is recorded as a job, and visible while it runs', () => {
  it('is running in the stored wine mid-lookup, and done with its price after', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()

    const response = post(wine.id)
    await run.started

    const mid = (await (await fetch(`${base}/${wine.id}`)).json()) as { enrichment_job: EnrichmentJobs; price_data: unknown }
    expect(mid.enrichment_job.price).toMatchObject({ state: 'running', identity: identityKey(wine) })
    expect(mid.price_data).toBeNull()

    run.finish({ retailers: [listing('a', 80), listing('b', 90)] })
    expect((await response).status).toBe(200)

    const after = await stored(wine.id)
    expect(after.enrichment_job!.price).toMatchObject({ state: 'done' })
    expect(after.price_data!.enriched_for).toBe(identityKey(wine))
    expect(activeJobCount()).toBe(0)
  })

  it('a lookup that could not run is recorded failed and leaves the stored price alone', async () => {
    const wine = await storage.createWine(WINE)
    const before = { price_min: 70, price_avg: 75, price_max: 80, other_vintage_price_range: null, retailers: [], nearest_retailer: null, fetched_at: '2026-09-01T00:00:00.000Z' }
    await storage.updateWine(wine.id, { price_data: before })
    mockFetchPriceData.mockResolvedValueOnce(null)

    const res = await post(wine.id, '?force=true')
    expect(res.status).toBe(503)
    expect(((await res.json()) as { outcome: string }).outcome).toBe('failed')
    expect((await stored(wine.id)).price_data).toMatchObject({ price_avg: 75 })
    expect(await priceJob(wine.id)).toMatchObject({ state: 'failed' })
  })

  it('an unexpected throw does not leave the job running', async () => {
    const wine = await storage.createWine(WINE)
    mockFetchPriceData.mockRejectedValueOnce(new Error('boom'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    expect((await post(wine.id)).status).toBeGreaterThanOrEqual(500)
    expect(await priceJob(wine.id)).toMatchObject({ state: 'failed' })
    expect(activeJobCount()).toBe(0)
  })

  it('bumps updated_at while it runs, and stops when it ends', async () => {
    process.env.ENRICHMENT_HEARTBEAT_MS = '25'
    const wine = await storage.createWine(WINE)
    const run = controlledRun()
    const response = post(wine.id)
    await run.started
    const first = (await priceJob(wine.id))!.updated_at
    await tick(120)
    const later = (await priceJob(wine.id))!
    expect(later.state).toBe('running')
    expect(Date.parse(later.updated_at)).toBeGreaterThan(Date.parse(first))
    run.finish({ retailers: [] })
    await response
    const done = await priceJob(wine.id)
    await tick(100)
    expect(await priceJob(wine.id)).toEqual(done)
  })
})

describe('one price lookup per wine', () => {
  it('two concurrent requests share one run and get the same answer', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()
    const first = post(wine.id)
    await run.started
    const second = post(wine.id, '?force=true')
    await tick()
    run.finish({ retailers: [listing('a', 80)] })

    const [a, b] = await Promise.all([first, second])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(mockFetchPriceData).toHaveBeenCalledTimes(1)
  })

  it('a running job is joined even when a fresh price is already stored', async () => {
    const wine = await storage.createWine(WINE)
    await storage.updateWine(wine.id, {
      price_data: { price_min: 1, price_avg: 1, price_max: 1, other_vintage_price_range: null, retailers: [], nearest_retailer: null, fetched_at: new Date().toISOString() },
    })
    const run = controlledRun()
    const first = post(wine.id, '?force=true')
    await run.started
    const second = post(wine.id) // would be answered from the fresh price if no job were running
    await tick()
    run.finish({ retailers: [listing('a', 80)] })

    const body = (await (await second).json()) as { cached?: boolean }
    await first
    expect(body.cached).toBeUndefined()
    expect(mockFetchPriceData).toHaveBeenCalledTimes(1)
  })

  it('a request answered from a fresh stored price starts no job', async () => {
    const wine = await storage.createWine(WINE)
    mockFetchPriceData.mockResolvedValueOnce({ retailers: [listing('a', 80)] })
    await post(wine.id)
    mockFetchPriceData.mockClear()

    const again = await post(wine.id)
    expect(((await again.json()) as { cached?: boolean }).cached).toBe(true)
    expect(mockFetchPriceData).not.toHaveBeenCalled()
  })

  it('the review search and the price lookup run side by side, each keeping its own state', async () => {
    const wine = await storage.createWine(WINE)
    const price = controlledRun()
    let finishReviews!: (value: unknown) => void
    let reviewsBegun!: () => void
    const reviewsStarted = new Promise<void>((resolve) => (reviewsBegun = resolve))
    mockFetchReviewData.mockImplementationOnce(() => {
      reviewsBegun()
      return new Promise((resolve) => (finishReviews = resolve))
    })

    const priceResponse = post(wine.id)
    const reviewsResponse = fetch(`${base}/${wine.id}/fetch-reviews`, { method: 'POST' })
    await Promise.all([price.started, reviewsStarted])

    const mid = (await stored(wine.id)).enrichment_job!
    expect(mid.price?.state).toBe('running')
    expect(mid.reviews?.state).toBe('running')

    price.finish({ retailers: [listing('a', 80)] })
    await priceResponse
    const afterPrice = (await stored(wine.id)).enrichment_job!
    expect(afterPrice.price?.state).toBe('done')
    expect(afterPrice.reviews?.state).toBe('running') // writing one kind never erases the other

    finishReviews([review('a', 2019, [score('Burghound', 92)])])
    await reviewsResponse
    const end = (await stored(wine.id)).enrichment_job!
    expect(end.price?.state).toBe('done')
    expect(end.reviews?.state).toBe('done')
  })
})

describe('cancellation', () => {
  it('discarding the wine mid-lookup drops the price and writes nothing', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()
    const response = post(wine.id)
    await run.started

    expect((await fetch(`${base}/${wine.id}`, { method: 'DELETE' })).status).toBe(204)
    run.finish({ retailers: [listing('a', 80)] })

    const res = await response
    expect(res.status).toBe(404)
    expect(((await res.json()) as { outcome: string }).outcome).toBe('cancelled')
    expect(await storage.getWine(wine.id)).toBeNull()
  })

  it('editing the identity mid-lookup drops the old price and clears the job', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()
    const response = post(wine.id)
    await run.started

    const edited = await patch(wine.id, { vintage: 2020 })
    expect(((await edited.json()) as { enrichment_job: EnrichmentJobs }).enrichment_job.price).toBeNull()

    run.finish({ retailers: [listing('a', 80)] })
    const res = await response
    expect(res.status).toBe(409)
    expect(((await res.json()) as { outcome: string }).outcome).toBe('cancelled')

    const after = await stored(wine.id)
    expect(after.vintage).toBe(2020)
    expect(after.price_data).toBeNull() // nothing found for 2019 is stamped onto the 2020
    expect(after.enrichment_job!.price).toBeNull()
  })

  it('the request after an identity edit starts a new lookup, not a join of the old one', async () => {
    const wine = await storage.createWine(WINE)
    const oldRun = controlledRun()
    const oldResponse = post(wine.id)
    await oldRun.started

    await patch(wine.id, { vintage: 2020 })
    const newRun = controlledRun()
    const newResponse = post(wine.id, '?force=true')
    await newRun.started
    expect(mockFetchPriceData).toHaveBeenCalledTimes(2)

    oldRun.finish({ retailers: [listing('old', 50)] })
    expect((await oldResponse).status).toBe(409)
    newRun.finish({ retailers: [listing('new', 95)] })
    expect((await newResponse).status).toBe(200)

    const after = await stored(wine.id)
    expect(after.price_data!.retailers.map((r) => r.slug)).toEqual(['new'])
    expect(after.price_data!.enriched_for).toBe(identityKey({ ...wine, vintage: 2020 }))
  })
})

describe('an interrupted lookup is run again, not answered from the price before it', () => {
  const stale = (updated_at: string) => ({ state: 'running' as const, started_at: updated_at, updated_at, identity: 'i' })

  it('a price job stored running with no heartbeat reads interrupted, and a plain request runs again', async () => {
    const wine = await storage.createWine(WINE)
    const old = new Date(Date.now() - 60_000).toISOString()
    await storage.updateWine(wine.id, {
      price_data: { price_min: 1, price_avg: 1, price_max: 1, other_vintage_price_range: null, retailers: [], nearest_retailer: null, fetched_at: new Date().toISOString() },
      enrichment_job: { price: stale(old) },
    })

    const read = (await (await fetch(`${base}/${wine.id}`)).json()) as { enrichment_job: EnrichmentJobs }
    expect(read.enrichment_job.price!.state).toBe('interrupted')

    mockFetchPriceData.mockResolvedValueOnce({ retailers: [listing('a', 80)] })
    const res = await post(wine.id) // no force: still runs, because the earlier lookup never finished
    expect(((await res.json()) as { cached?: boolean }).cached).toBeUndefined()
    expect(mockFetchPriceData).toHaveBeenCalledTimes(1)
    expect(await priceJob(wine.id)).toMatchObject({ state: 'done' })
  })
})
