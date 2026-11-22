/**
 * Phase 14 (WI-1): a review search is one persisted job per wine.
 *
 * Real in-memory SQLite and the real router; only the review module is
 * replaced, by a run the test finishes by hand, so each test can act while a
 * search is still going.
 */
import express from 'express'
import Database from 'better-sqlite3'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { SQLiteAdapter } from '../../modules/storage/sqlite-adapter'
import type { CreateWineInput, EnrichmentJobs, RetailerReview } from '@shared/types'
import { identityKey } from '@shared/utils/wine-match'
import { review, score } from '../helpers/review-fixtures'

let storage: SQLiteAdapter
jest.mock('../../modules/storage', () => ({ getStorage: () => storage }))

const mockFetchReviewData = jest.fn()
jest.mock('../../modules/price', () => ({
  fetchPriceData: jest.fn(),
  aggregatePriceData: jest.requireActual('../../modules/price').aggregatePriceData,
}))
jest.mock('../../modules/reviews', () => ({
  fetchReviewData: (...args: unknown[]) => mockFetchReviewData(...args),
}))

import winesRouter from '../../routes/wines'
import { activeJobCount, recoverInterruptedJobs } from '../../routes/enrichment-jobs'

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
  mockFetchReviewData.mockReset()
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

/** A review run the test finishes by hand. `started` resolves once the route has called it. */
function controlledRun() {
  let finish!: (value: RetailerReview[] | null) => void
  let begun!: () => void
  const started = new Promise<void>((resolve) => (begun = resolve))
  const result = new Promise<RetailerReview[] | null>((resolve) => (finish = resolve))
  mockFetchReviewData.mockImplementationOnce(() => {
    begun()
    return result
  })
  return { started, finish }
}

const post = (id: string, query = '') => fetch(`${base}/${id}/fetch-reviews${query}`, { method: 'POST' })
const patch = (id: string, body: unknown) =>
  fetch(`${base}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const jobsOf = async (id: string): Promise<EnrichmentJobs | null | undefined> => (await storage.getWine(id))!.enrichment_job

describe('the job is recorded, and visible while it runs', () => {
  it('is running in the stored wine mid-search, and done with its counts after', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()

    const response = post(wine.id)
    await run.started

    // What GET /api/wines/:id returns, which is what a client polls.
    const mid = (await (await fetch(`${base}/${wine.id}`)).json()) as { enrichment_job: EnrichmentJobs }
    expect(mid.enrichment_job.reviews).toMatchObject({ state: 'running', stage: 'shops', identity: identityKey(wine) })

    run.finish([review('a', 2019, [score('Burghound', 91)])])
    expect((await response).status).toBe(200)

    expect((await jobsOf(wine.id))!.reviews).toMatchObject({ state: 'done', scores_found: 1 })
    expect(activeJobCount()).toBe(0)
  })

  it('shows on the list as well as the single wine', async () => {
    const wine = await storage.createWine(WINE)
    await storage.updateWine(wine.id, { promoted_at: '2026-11-01T00:00:00.000Z' })
    const run = controlledRun()
    const response = post(wine.id)
    await run.started

    const list = (await (await fetch(base)).json()) as Array<{ id: string; enrichment_job: EnrichmentJobs }>
    expect(list.find((w) => w.id === wine.id)!.enrichment_job.reviews?.state).toBe('running')

    run.finish([])
    await response
  })

  it('a failed run is recorded as failed and leaves the stored reviews alone', async () => {
    const wine = await storage.createWine(WINE)
    const existing = [review('a', 2019, [score('Vinous', 93)])]
    await storage.updateWine(wine.id, { review_data: existing })
    mockFetchReviewData.mockResolvedValueOnce(null)

    const res = await post(wine.id, '?force=true')
    expect(res.status).toBe(503)
    expect(((await res.json()) as { outcome: string }).outcome).toBe('failed')

    const stored = (await storage.getWine(wine.id))!
    expect(stored.review_data).toEqual(existing.map((r) => expect.objectContaining({ slug: r.slug })))
    expect(stored.enrichment_job!.reviews).toMatchObject({ state: 'failed' })
  })

  it('an unexpected throw does not leave the job running', async () => {
    const wine = await storage.createWine(WINE)
    mockFetchReviewData.mockRejectedValueOnce(new Error('boom'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const res = await post(wine.id)
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect((await jobsOf(wine.id))!.reviews).toMatchObject({ state: 'failed' })
    expect(activeJobCount()).toBe(0)
  })

  it('a request answered from fresh stored data starts no job', async () => {
    const wine = await storage.createWine(WINE)
    mockFetchReviewData.mockResolvedValueOnce([{ ...review('a', 2019, [score('Vinous', 93)]), fetched_at: new Date().toISOString() }])
    await post(wine.id, '?tier=primary')
    mockFetchReviewData.mockClear()

    const again = await post(wine.id, '?tier=primary')
    expect(((await again.json()) as { cached?: boolean }).cached).toBe(true)
    expect(mockFetchReviewData).not.toHaveBeenCalled()
  })
})

describe('one search per wine', () => {
  it('two concurrent requests share one run and get the same answer', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()

    const first = post(wine.id)
    await run.started
    const second = post(wine.id)
    // Give the second request time to reach the route and attach.
    await new Promise((resolve) => setTimeout(resolve, 50))
    run.finish([review('a', 2019, [score('Burghound', 91)])])

    const [a, b] = await Promise.all([first, second])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(mockFetchReviewData).toHaveBeenCalledTimes(1)
    expect(((await b.json()) as { review_data: unknown[] }).review_data).toHaveLength(1)
  })

  it('a forced request while one is running attaches too (a Refresh tap during a scan search)', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()

    const scan = post(wine.id) // the new scan path: no tier, the full search
    await run.started
    const tap = post(wine.id, '?force=true')
    await new Promise((resolve) => setTimeout(resolve, 50))
    run.finish([])

    expect((await scan).status).toBe(200)
    expect((await tap).status).toBe(200)
    expect(mockFetchReviewData).toHaveBeenCalledTimes(1)
  })

  it('a running job is joined even when stored reviews look fresh', async () => {
    // Per-shop saves (WI-2) make stored data look fresh mid-search; that must
    // not answer a request with a partial result.
    const wine = await storage.createWine(WINE)
    await storage.updateWine(wine.id, { review_data: [{ ...review('a', 2019, []), fetched_at: new Date().toISOString() }] })
    const run = controlledRun()

    const first = post(wine.id, '?force=true')
    await run.started
    const second = post(wine.id)
    await new Promise((resolve) => setTimeout(resolve, 50))
    run.finish([review('b', 2019, [score('Vinous', 94)])])

    const body = (await (await second).json()) as { cached?: boolean; review_data: Array<{ slug: string }> }
    await first
    expect(body.cached).toBeUndefined()
    expect(body.review_data.map((r) => r.slug)).toEqual(['b'])
  })

  it('a full request waits for a stale client\'s primary run, then runs the full search', async () => {
    const wine = await storage.createWine(WINE)
    const primary = controlledRun()
    const primaryResponse = post(wine.id, '?tier=primary')
    await primary.started

    const full = controlledRun()
    const fullResponse = post(wine.id) // no tier: the full search
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockFetchReviewData).toHaveBeenCalledTimes(1) // the full one has not started

    primary.finish([])
    await primaryResponse
    await full.started
    expect(mockFetchReviewData).toHaveBeenCalledTimes(2)
    expect(mockFetchReviewData.mock.calls[1][1]).toMatchObject({ tier: 'full' })

    full.finish([review('a', 2019, [score('Burghound', 91)])])
    expect(((await (await fullResponse).json()) as { review_data: unknown[] }).review_data).toHaveLength(1)
  })

  it('?tier=primary still means the primary tier (stale clients, spec D8)', async () => {
    const wine = await storage.createWine(WINE)
    mockFetchReviewData.mockResolvedValueOnce([])
    await post(wine.id, '?tier=primary')
    expect(mockFetchReviewData.mock.calls[0][1]).toMatchObject({ tier: 'primary' })
  })
})

describe('cancellation', () => {
  it('discarding the wine mid-search drops the results and writes nothing', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()
    const response = post(wine.id)
    await run.started

    expect((await fetch(`${base}/${wine.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(activeJobCount()).toBe(0)

    run.finish([review('a', 2019, [score('Burghound', 91)])])
    const res = await response
    expect(res.status).toBe(404)
    expect(((await res.json()) as { outcome: string }).outcome).toBe('cancelled')
    expect(await storage.getWine(wine.id)).toBeNull()
  })

  it('a stale draft swept mid-search is dropped the same way', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()
    const response = post(wine.id)
    await run.started

    await storage.sweepStaleDrafts(new Date(Date.now() + 60_000))
    run.finish([review('a', 2019, [])])

    expect((await response).status).toBe(404)
  })

  it('editing the identity mid-search drops the old results and clears the job', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()
    const response = post(wine.id)
    await run.started

    const edited = await patch(wine.id, { vintage: 2020 })
    expect(edited.status).toBe(200)
    expect(((await edited.json()) as { enrichment_job: EnrichmentJobs }).enrichment_job.reviews).toBeNull()

    run.finish([review('a', 2019, [score('Burghound', 91)])])
    const res = await response
    expect(res.status).toBe(409)
    expect(((await res.json()) as { outcome: string }).outcome).toBe('cancelled')

    const stored = (await storage.getWine(wine.id))!
    expect(stored.vintage).toBe(2020)
    expect(stored.review_data ?? []).toEqual([]) // nothing from the old identity
    expect(stored.enrichment_job!.reviews).toBeNull()
  })

  it('the request after an identity edit starts a new search, not a join of the old one', async () => {
    const wine = await storage.createWine(WINE)
    const oldRun = controlledRun()
    const oldResponse = post(wine.id)
    await oldRun.started

    await patch(wine.id, { vintage: 2020 })
    const newRun = controlledRun()
    const newResponse = post(wine.id, '?force=true')
    await newRun.started
    expect(mockFetchReviewData).toHaveBeenCalledTimes(2)

    // The old run ends late: dropped. The new one lands.
    oldRun.finish([review('old', 2019, [score('Burghound', 91)])])
    expect((await oldResponse).status).toBe(409)
    newRun.finish([review('new', 2020, [score('Vinous', 95)])])
    expect((await newResponse).status).toBe(200)

    const stored = (await storage.getWine(wine.id))!
    expect(stored.review_data!.map((r) => r.slug)).toEqual(['new'])
    expect(stored.review_data![0].enriched_for).toBe(identityKey({ ...wine, vintage: 2020 }))
    expect(stored.enrichment_job!.reviews).toMatchObject({ state: 'done', identity: identityKey({ ...wine, vintage: 2020 }) })
  })

  it('an edit that leaves the identity alone does not cancel the search', async () => {
    const wine = await storage.createWine(WINE)
    const run = controlledRun()
    const response = post(wine.id)
    await run.started

    await patch(wine.id, { wishlist_notes: 'for the autumn' })
    run.finish([review('a', 2019, [score('Burghound', 91)])])

    expect((await response).status).toBe(200)
    expect((await storage.getWine(wine.id))!.review_data).toHaveLength(1)
  })
})

describe('the column belongs to the server', () => {
  it('a client cannot write enrichment_job through PATCH', async () => {
    const wine = await storage.createWine(WINE)
    const forged = { reviews: { state: 'running', stage: 'shops', started_at: 'x', updated_at: 'x', shops_total: 1, shops_done: 0, scores_found: 0, identity: 'x' } }
    const res = await patch(wine.id, { enrichment_job: forged, wishlist_notes: 'ok' })
    expect(res.status).toBe(200)
    expect((await storage.getWine(wine.id))!.enrichment_job).toBeNull()
  })

  it('a wine with no lookup has a null job, and the other kind survives a write to one', async () => {
    const wine = await storage.createWine(WINE)
    expect((await storage.getWine(wine.id))!.enrichment_job).toBeNull()

    const priceJob = { state: 'done' as const, started_at: 'a', updated_at: 'b', identity: 'i' }
    await storage.updateWine(wine.id, { enrichment_job: { price: priceJob } })
    mockFetchReviewData.mockResolvedValueOnce([])
    await post(wine.id)

    const jobs = (await jobsOf(wine.id))!
    expect(jobs.price).toEqual(priceJob)
    expect(jobs.reviews?.state).toBe('done')
  })
})

describe('recoverInterruptedJobs (a machine that stopped mid-search)', () => {
  it("marks a stored 'running' job interrupted, touching nothing else", async () => {
    const running = await storage.createWine(WINE)
    const done = await storage.createWine({ ...WINE, producer: 'Other' })
    const job = (state: 'running' | 'done') => ({
      state, stage: 'shops' as const, started_at: 'a', updated_at: 'b', shops_total: 5, shops_done: 2, scores_found: 1, identity: 'i',
    })
    await storage.updateWine(running.id, { enrichment_job: { reviews: job('running'), price: { state: 'running', started_at: 'a', updated_at: 'b', identity: 'i' } } })
    await storage.updateWine(done.id, { enrichment_job: { reviews: job('done') } })

    expect(await recoverInterruptedJobs()).toBe(1)

    const after = (await jobsOf(running.id))!
    expect(after.reviews).toMatchObject({ state: 'interrupted', shops_done: 2 })
    expect(after.price).toMatchObject({ state: 'interrupted' })
    expect((await jobsOf(done.id))!.reviews!.state).toBe('done')
    expect(await recoverInterruptedJobs()).toBe(0)
  })
})
