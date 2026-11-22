/**
 * Phase 14 (WI-2, WI-3): a search saves each shop as it finishes, keeps a
 * heartbeat, is reported interrupted when its machine stops, and is carried on
 * rather than started over.
 *
 * The review module is replaced by a script the test drives through the same
 * callbacks the real one calls (`progress`, `probeLogSink`, `isCancelled`), so
 * each test can look at the stored wine between two events.
 */
import express from 'express'
import Database from 'better-sqlite3'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { SQLiteAdapter } from '../../modules/storage/sqlite-adapter'
import type { CreateWineInput, EnrichmentJobs, RetailerReview, ReviewProbeLogEntry } from '@shared/types'
import type { ReviewFetchOptions } from '../../modules/reviews'
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
import { startOrJoin, waitForJobs, withLiveJobs } from '../../routes/enrichment-jobs'

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

const now = () => new Date().toISOString()
const fresh = (slug: string, publication = 'Burghound', value = 92) =>
  review(slug, 2019, [score(publication, value)], 'match', { fetched_at: now() })
const probe = (slug: string, stage: ReviewProbeLogEntry['stage'], probed_at = now()): ReviewProbeLogEntry =>
  ({ slug, domain: `${slug}.example`, stage, variants_tried: 1, probed_at })

type Opts = ReviewFetchOptions

/** Drives the mocked module for one run: `script` calls the callbacks and returns what the module would. */
function scripted(script: (opts: Opts) => Promise<RetailerReview[] | null>) {
  mockFetchReviewData.mockImplementationOnce((_wine: unknown, opts: Opts) => script(opts))
}
const gate = () => {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { opened, open }
}
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

const post = (id: string, query = '') => fetch(`${base}/${id}/fetch-reviews${query}`, { method: 'POST' })
const patch = (id: string, body: unknown) =>
  fetch(`${base}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const stored = async (id: string) => (await storage.getWine(id))!
const reviewsJob = async (id: string) => (await stored(id)).enrichment_job?.reviews

describe('WI-2: each shop is saved as it finishes', () => {
  it('shows scores and progress in the stored wine mid-search', async () => {
    const wine = await storage.createWine(WINE)
    const hold = gate()
    scripted(async (opts) => {
      opts.progress!.onPlan!({ shopsTotal: 11, shopsSettled: 1 })
      opts.progress!.onShop!({ slug: 'a', result: fresh('a') as never, probe: undefined })
      await hold.opened
      return [fresh('a')]
    })

    const response = post(wine.id)
    await tick()

    const mid = await stored(wine.id)
    expect(mid.review_data!.map((r) => r.slug)).toEqual(['a'])
    expect(mid.critic_summary!.ordered).toHaveLength(1)
    expect(mid.enrichment_job!.reviews).toMatchObject({ state: 'running', stage: 'shops', shops_total: 11, shops_done: 2, scores_found: 1 })

    hold.open()
    expect((await response).status).toBe(200)
    expect(await reviewsJob(wine.id)).toMatchObject({ state: 'done', shops_total: 11, scores_found: 1 })
  })

  it('shops finishing in the same tick are all saved, and a late save never sets a finished job back to running', async () => {
    const wine = await storage.createWine(WINE)
    scripted(async (opts) => {
      opts.progress!.onPlan!({ shopsTotal: 3, shopsSettled: 0 })
      // Three shops land at once and the run ends in the same tick: three saves are
      // still queued when the module returns.
      for (const slug of ['a', 'b', 'c']) opts.progress!.onShop!({ slug, result: fresh(slug) as never, probe: undefined })
      return [fresh('a'), fresh('b'), fresh('c')]
    })

    expect((await post(wine.id)).status).toBe(200)
    await tick(50) // time for any save that was left behind to land
    const after = await stored(wine.id)
    expect(after.review_data!.map((r) => r.slug).sort()).toEqual(['a', 'b', 'c'])
    expect(after.enrichment_job!.reviews).toMatchObject({ state: 'done', shops_done: 3, shops_total: 3 })
  })

  it('a refresh replaces old results shop by shop, keeps the rest on screen, and drops them only when the run is done', async () => {
    const wine = await storage.createWine(WINE)
    const old = (slug: string) => review(slug, 2019, [score('Vinous', 90)], 'match', { fetched_at: '2026-09-01T00:00:00.000Z' })
    await storage.updateWine(wine.id, { review_data: [old('a'), old('b')] })
    const hold = gate()
    scripted(async (opts) => {
      opts.progress!.onShop!({ slug: 'a', result: fresh('a', 'Burghound', 95) as never, probe: undefined })
      await hold.opened
      return [fresh('a', 'Burghound', 95)] // b was not reached or found nothing this time
    })

    const response = post(wine.id, '?force=true')
    await tick()

    const mid = (await stored(wine.id)).review_data!
    expect(mid.map((r) => r.slug).sort()).toEqual(['a', 'b'])
    expect(mid.find((r) => r.slug === 'a')!.critic_scores[0].score).toBe(95) // replaced
    expect(mid.find((r) => r.slug === 'b')!.critic_scores[0].score).toBe(90) // still on screen

    hold.open()
    await response
    expect((await stored(wine.id)).review_data!.map((r) => r.slug)).toEqual(['a']) // dropped at done
  })

  it('a probe that failed to run is stored as request_failed, never as a negative', async () => {
    const wine = await storage.createWine(WINE)
    const hold = gate()
    scripted(async (opts) => {
      opts.probeLogSink!.push(probe('a', 'request_failed'), probe('b', 'zero_results'))
      opts.progress!.onShop!({ slug: 'a', result: null, probe: opts.probeLogSink![0] })
      await hold.opened
      return [fresh('c')]
    })

    const response = post(wine.id)
    await tick()
    expect((await stored(wine.id)).review_probe_log!.find((e) => e.slug === 'a')!.stage).toBe('request_failed')
    hold.open()
    await response
  })

  it('a run that could not run leaves the old review_data untouched and the job failed', async () => {
    const wine = await storage.createWine(WINE)
    const existing = review('keep', 2019, [score('Vinous', 93)], 'match', { fetched_at: '2026-09-01T00:00:00.000Z' })
    await storage.updateWine(wine.id, { review_data: [existing] })
    scripted(async (opts) => {
      opts.progress!.onPlan!({ shopsTotal: 11, shopsSettled: 0 })
      for (let i = 0; i < 11; i++) opts.progress!.onShop!({ slug: `s${i}`, result: null, probe: undefined })
      return null // every request failed
    })

    const res = await post(wine.id, '?force=true')
    expect(res.status).toBe(503)
    expect((await stored(wine.id)).review_data!.map((r) => r.slug)).toEqual(['keep'])
    expect(await reviewsJob(wine.id)).toMatchObject({ state: 'failed' })
  })

  it('reports Stage B and extra results as they arrive', async () => {
    const wine = await storage.createWine(WINE)
    const hold = gate()
    scripted(async (opts) => {
      opts.progress!.onStage!('merchants')
      opts.progress!.onExtra!({ ...fresh('fallback-x.com'), source: 'fallback' } as never)
      await hold.opened
      return [fresh('fallback-x.com')]
    })
    const response = post(wine.id)
    await tick()
    expect(await reviewsJob(wine.id)).toMatchObject({ stage: 'merchants', scores_found: 1 })
    expect((await stored(wine.id)).review_data!.map((r) => r.slug)).toEqual(['fallback-x.com'])
    hold.open()
    await response
  })

  it('tells the module when the search is cancelled, so it stops launching shops', async () => {
    const wine = await storage.createWine(WINE)
    const hold = gate()
    let seen: boolean[] = []
    scripted(async (opts) => {
      seen.push(opts.isCancelled!())
      await hold.opened
      seen.push(opts.isCancelled!())
      return []
    })
    const response = post(wine.id)
    await tick()
    await fetch(`${base}/${wine.id}`, { method: 'DELETE' })
    hold.open()
    await response
    expect(seen).toEqual([false, true])
  })
})

describe('WI-2: an identity edit discards what the old identity found', () => {
  it('removes the cancelled run\'s saved pages and probe entries, keeps what was there before it, and re-derives', async () => {
    const wine = await storage.createWine(WINE)
    const before = review('older', 2019, [score('Vinous', 91, { window: [2025, 2035] })], 'match', { fetched_at: '2026-09-01T00:00:00.000Z' })
    await storage.updateWine(wine.id, {
      review_data: [before],
      review_probe_log: [probe('older', 'found', '2026-09-01T00:00:00.000Z')],
    })
    const hold = gate()
    scripted(async (opts) => {
      opts.probeLogSink!.push(probe('a', 'zero_results'))
      opts.progress!.onShop!({ slug: 'a', result: fresh('a') as never, probe: opts.probeLogSink![0] })
      await hold.opened
      return []
    })
    // Unforced: a forced run clears the probe log by design, which is a different test.
    const response = post(wine.id)
    await tick()
    expect((await stored(wine.id)).review_data!.map((r) => r.slug).sort()).toEqual(['a', 'older'])

    const edited = await patch(wine.id, { vintage: 2020 })
    expect(edited.status).toBe(200)

    const after = await stored(wine.id)
    expect(after.review_data!.map((r) => r.slug)).toEqual(['older'])
    // The old identity's "this shop has nothing" must not suppress the new search.
    expect(after.review_probe_log!.map((e) => e.slug)).toEqual(['older'])
    expect(after.enrichment_job!.reviews).toBeNull()

    hold.open()
    expect((await response).status).toBe(409)
    expect((await stored(wine.id)).review_data!.map((r) => r.slug)).toEqual(['older'])
  })

  it('drops a window that was derived only from what the cancelled run found', async () => {
    const wine = await storage.createWine(WINE)
    const hold = gate()
    scripted(async (opts) => {
      opts.progress!.onShop!({ slug: 'a', result: review('a', 2019, [score('Burghound', 92, { window: [2026, 2038] })], 'match', { fetched_at: now() }) as never, probe: undefined })
      await hold.opened
      return []
    })
    const response = post(wine.id)
    await tick()
    expect((await stored(wine.id)).drinking_window_source).toBe('derived')

    await patch(wine.id, { vintage: 2020 })
    const after = await stored(wine.id)
    expect(after.drinking_window).toBeNull()
    expect(after.drinking_window_source).toBeNull()
    hold.open()
    await response
  })
})

describe('WI-3: the heartbeat', () => {
  it('bumps updated_at while a search runs', async () => {
    process.env.ENRICHMENT_HEARTBEAT_MS = '25'
    const wine = await storage.createWine(WINE)
    const hold = gate()
    scripted(async () => {
      await hold.opened
      return []
    })
    const response = post(wine.id)
    await tick(10)
    const first = (await reviewsJob(wine.id))!.updated_at
    await tick(120)
    const later = (await reviewsJob(wine.id))!
    expect(later.state).toBe('running')
    expect(Date.parse(later.updated_at)).toBeGreaterThan(Date.parse(first))
    hold.open()
    await response
  })

  it('stops beating when the search ends', async () => {
    process.env.ENRICHMENT_HEARTBEAT_MS = '25'
    const wine = await storage.createWine(WINE)
    scripted(async () => [])
    await post(wine.id)
    const done = (await reviewsJob(wine.id))!
    await tick(100)
    expect(await reviewsJob(wine.id)).toEqual(done)
  })
})

describe('WI-3: a stopped machine is reported interrupted on read', () => {
  const job = (updated_at: string, state: 'running' | 'done' = 'running') => ({
    state, stage: 'shops' as const, started_at: '2026-11-22T10:00:00.000Z', updated_at, shops_total: 11, shops_done: 3, scores_found: 1, identity: 'i',
  })

  it("a running job with no heartbeat for over 30 s and nobody running it reads as interrupted, and nothing is written", async () => {
    const wine = await storage.createWine(WINE)
    const old = new Date(Date.now() - 31_000).toISOString()
    await storage.updateWine(wine.id, { enrichment_job: { reviews: job(old) } })

    const body = (await (await fetch(`${base}/${wine.id}`)).json()) as { enrichment_job: EnrichmentJobs }
    expect(body.enrichment_job.reviews!.state).toBe('interrupted')
    const list = (await (await fetch(`${base}?include_drafts=true`)).json()) as Array<{ enrichment_job: EnrichmentJobs }>
    expect(list[0].enrichment_job.reviews!.state).toBe('interrupted')
    expect((await reviewsJob(wine.id))!.state).toBe('running') // the read changed nothing
  })

  it('a recent heartbeat, or a job this process is running, reads as running', async () => {
    const wine = await storage.createWine(WINE)
    const recent = { ...wine, enrichment_job: { reviews: job(new Date().toISOString()) } }
    expect(withLiveJobs(recent).enrichment_job!.reviews!.state).toBe('running')

    const old = { ...wine, enrichment_job: { reviews: job(new Date(Date.now() - 600_000).toISOString()) } }
    const hold = gate()
    const { promise } = startOrJoin(wine.id, 'reviews', { tier: 'full', identity: 'i' }, async () => hold.opened)
    expect(withLiveJobs(old).enrichment_job!.reviews!.state).toBe('running') // alive here, just slow to beat
    hold.open()
    await promise
    expect(withLiveJobs(old).enrichment_job!.reviews!.state).toBe('interrupted') // and once gone, not
  })

  it('leaves finished jobs and unknown states alone', async () => {
    const wine = await storage.createWine(WINE)
    const finished = { ...wine, enrichment_job: { reviews: job('2020-01-01T00:00:00.000Z', 'done') } }
    expect(withLiveJobs(finished)).toBe(finished)
    expect(withLiveJobs(wine)).toBe(wine)
  })
})

describe('WI-3: SIGTERM waits for running searches', () => {
  it('resolves true once every job has ended', async () => {
    const hold = gate()
    const { promise } = startOrJoin('w1', 'reviews', { tier: 'full', identity: 'i' }, async () => hold.opened)
    const waiting = waitForJobs(5_000)
    hold.open()
    await promise
    expect(await waiting).toBe(true)
  })

  it('resolves false when a job outlasts the grace period, without cancelling it', async () => {
    const hold = gate()
    const { promise } = startOrJoin('w2', 'reviews', { tier: 'full', identity: 'i' }, async () => hold.opened)
    expect(await waitForJobs(30)).toBe(false)
    hold.open()
    await promise
  })

  it('resolves true at once when nothing is running', async () => {
    expect(await waitForJobs(5_000)).toBe(true)
  })
})

describe('WI-3: an interrupted search is resumed once, not started over', () => {
  const STARTED = '2026-11-22T10:00:00.000Z'
  /** What a run killed after three shops leaves behind. */
  async function killedAfterThreeShops() {
    const wine = await storage.createWine(WINE)
    const savedAt = '2026-11-22T10:00:30.000Z'
    await storage.updateWine(wine.id, {
      review_data: ['a', 'b'].map((slug) => review(slug, 2019, [score('Vinous', 90)], 'match', { fetched_at: savedAt })),
      review_probe_log: [probe('a', 'found', savedAt), probe('b', 'found', savedAt), probe('c', 'zero_results', savedAt)],
      enrichment_job: {
        reviews: { state: 'running', stage: 'shops', started_at: STARTED, updated_at: savedAt, shops_total: 11, shops_done: 3, scores_found: 2, identity: identityKey(wine) },
      },
    })
    return wine
  }

  it('does not answer from the partial data, and hands the module what was saved and where it began', async () => {
    const wine = await killedAfterThreeShops()
    let received: Opts | undefined
    scripted(async (opts) => {
      received = opts
      return [fresh('a'), fresh('b'), fresh('d')]
    })

    const res = await post(wine.id) // the app's one automatic resume: a plain POST
    expect(res.status).toBe(200)
    expect(((await res.json()) as { cached?: boolean }).cached).toBeUndefined()

    expect(mockFetchReviewData).toHaveBeenCalledTimes(1)
    expect(received!.resume!.since).toBe(STARTED)
    expect(received!.resume!.priorResults.map((r) => r.slug).sort()).toEqual(['a', 'b'])
    expect(received!.existingProbeLog!.map((e) => e.slug).sort()).toEqual(['a', 'b', 'c']) // not cleared
    const job = await reviewsJob(wine.id)
    expect(job).toMatchObject({ state: 'done', started_at: STARTED }) // the interrupted run's own clock
  })

  it('a forced request starts over: no resume, and the probe log is cleared', async () => {
    const wine = await killedAfterThreeShops()
    let received: Opts | undefined
    scripted(async (opts) => {
      received = opts
      return []
    })
    await post(wine.id, '?force=true')
    expect(received!.resume).toBeUndefined()
    expect(received!.existingProbeLog).toEqual([])
    expect((await reviewsJob(wine.id))!.started_at).not.toBe(STARTED)
  })

  it('a search that finished is answered from the stored data as before', async () => {
    const wine = await storage.createWine(WINE)
    scripted(async () => [fresh('a')])
    await post(wine.id, '?tier=primary')
    mockFetchReviewData.mockClear()

    const again = await post(wine.id, '?tier=primary')
    expect(((await again.json()) as { cached?: boolean }).cached).toBe(true)
    expect(mockFetchReviewData).not.toHaveBeenCalled()
  })

  it('a running search in this process is joined, never resumed on top of', async () => {
    const wine = await killedAfterThreeShops()
    const hold = gate()
    scripted(async () => {
      await hold.opened
      return []
    })
    const first = post(wine.id)
    await tick()
    const second = post(wine.id)
    await tick()
    hold.open()
    await Promise.all([first, second])
    expect(mockFetchReviewData).toHaveBeenCalledTimes(1)
  })
})
