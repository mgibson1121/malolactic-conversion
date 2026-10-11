/**
 * POST /api/wines/:id/choose-bottling against a real in-memory SQLite adapter
 * (Phase 12.2 WI-2.5): the Vietti Barolo 2021 case, where the plain wine and
 * two named single-vineyard bottlings were all in the results.
 */
import express from 'express'
import Database from 'better-sqlite3'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { SQLiteAdapter } from '../../modules/storage/sqlite-adapter'
import type { CreateWineInput, PriceData, RetailerPrice } from '@shared/types'
import { aggregatePriceData } from '../../modules/price/aggregate'
import { bottlingDifference } from '@shared/utils/bottling-difference'
import { review, score } from '../helpers/review-fixtures'

let storage: SQLiteAdapter
jest.mock('../../modules/storage', () => ({ getStorage: () => storage }))

import winesRouter from '../../routes/wines'

let server: Server
let base: string
const realFetch = global.fetch

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/wines', winesRouter)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
})
afterAll(() => new Promise((resolve) => server.close(resolve)))
beforeEach(() => {
  storage = new SQLiteAdapter(new Database(':memory:'))
})

const VIETTI: CreateWineInput = {
  producer: 'Vietti', vintage: 2021, region: 'Piedmont', denomination: 'Barolo',
  grape_varieties: ['Nebbiolo'], label_image_url: null,
  tag_discovered: false, tag_wishlist: false, tag_cellar: true, tag_consumed: false,
  cellar_quantity: 1, cellar_category: null, drinking_window: null,
  vintage_rating: null, my_rating: null, my_tags: [], wishlist_notes: null,
  price_paid: null, purchased_from: null, date_first_consumed: null,
  quality_classification: null, vineyard: null, cuvee: null, wine_color: 'red',
}

function listing(slug: string, title: string, price: number): RetailerPrice {
  const d = bottlingDifference({ title }, { producer: 'Vietti', denomination: 'Barolo', vintage: 2021, cuvee: null, vineyard: null, quality_classification: null })
  return {
    slug, name: slug, price, url: `https://${slug}.example/p`, distance_miles: 5, is_preferred_retailer: true,
    is_search_results_page: false, matched_vintage: 2021, vintage_mismatch: false, vintage_verdict: 'match',
    pack_quantity: 1, bottle_size_ml: null, non_standard_format: false, format_label: '', link_only: false, verification: 'verified',
    listing_title: title, bottling_difference: { extra: d.extra, missing: d.missing },
  }
}

async function viettiWine() {
  const created = await storage.createWine(VIETTI)
  const listings = [
    listing('zachys', 'Vietti Barolo 2021', 74.99),
    listing('thatchers', 'Vietti Barolo Castiglione 2021', 149),
    listing('flatiron', 'Vietti Barolo Castiglione 2021', 199.99),
    listing('sokolin', 'Vietti Barolo Rocche 2021', 229),
    listing('macarthur', 'Vietti Barolo Rocche 2021', 245),
  ]
  const price_data: PriceData = { ...aggregatePriceData(listings as never), fetched_at: '2026-10-02T03:06:37.929Z' }
  return storage.updateWine(created.id, {
    promoted_at: '2026-10-01T00:00:00.000Z',
    price_data,
    review_data: [
      review('woodland', 2021, [score('Decanter', 95)], undefined, { product_url: 'https://whwc.com/vietti-barolo-castiglione-2021/' }),
      review('winelibrary', 2021, [score('James Suckling', 95)], undefined, { product_url: 'https://winelibrary.com/wines/nebbiolo/2021-vietti-barolo-147735' }),
      review('jjbuckley', 2021, [score('Wine Advocate', 97)], undefined, { product_url: 'https://www.jjbuckley.com/wine/2021-vietti-barolo-monvigliero/2021-1879291-1500/' }),
    ],
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asJson = (r: Response) => r.json() as Promise<any>
const choose = (id: string, body: unknown) =>
  fetch(`${base}/wines/${id}/choose-bottling`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('the prompt the wine carries before an answer', () => {
  it('shows a price split, Tier 2, and the named bottlings found', async () => {
    const w = await viettiWine()
    expect(w.price_data?.headline_basis).toBe('ambiguous')
    expect(w.review_ladder?.tier).toBe('2')
    expect(w.bottling_prompt?.reasons).toEqual(expect.arrayContaining(['modifiers', 'price_split']))
    expect(w.bottling_prompt?.options.map((o) => o.name)).toEqual(expect.arrayContaining(['Castiglione', 'Monvigliero', 'Rocche']))
  })
})

describe('POST /:id/choose-bottling', () => {
  let spy: jest.SpyInstance
  beforeEach(() => {
    spy = jest.spyOn(global, 'fetch')
  })
  afterEach(() => {
    spy.mockRestore()
    global.fetch = realFetch
  })

  it('"Castiglione": writes the vineyard, re-scores with no outbound call, climbs to Tier 1 and recomputes the headline from the matching set', async () => {
    const w = await viettiWine()
    spy.mockClear()
    const calls = spy.mock.calls.length
    const res = await choose(w.id, { choice: 'vineyard', name: 'Castiglione' })
    // The only fetch is this test's own request to the local server.
    expect(spy.mock.calls.slice(calls).every((c) => String(c[0]).startsWith('http://127.0.0.1'))).toBe(true)
    expect(res.status).toBe(200)
    const body = await asJson(res)

    expect(body.wine.vineyard).toBe('Castiglione')
    expect(body.wine.bottling_plain).toBeNull()
    expect(body.result.tier).toBe('1')
    expect(body.result.trusted_scores).toBe(1)

    // Price: only the two Castiglione listings count; the rest are listed, labelled, outside.
    const pd = body.wine.price_data
    expect(pd.price_min).toBe(149)
    expect(pd.price_max).toBe(199.99)
    expect(pd.headline_basis).toBe('multiple')
    expect(pd.excluded.outside_bottling).toBe(3)
    expect(pd.retailers).toHaveLength(5)
    expect(pd.retailers.find((r: { slug: string }) => r.slug === 'zachys').outside_bottling).toBe(true)
    // A local re-score is not a fetch: the data keeps its age, and is no longer "stale".
    expect(pd.fetched_at).toBe('2026-10-02T03:06:37.929Z')
    expect(body.wine.enrichment_stale).toEqual({ price: false, reviews: false })
    // Answered, so the prompt is gone.
    expect(body.wine.bottling_prompt).toBeNull()
  })

  it('"Plain": sets the flag, counts the plain listing alone as the matching set, and never asks again', async () => {
    const w = await viettiWine()
    const body = await asJson(await choose(w.id, { choice: 'plain' }))
    expect(body.wine.bottling_plain).toBe(true)
    expect(body.wine.price_data.price_avg).toBe(74.99)
    expect(body.wine.price_data.headline_basis).toBe('single_listing')
    expect(body.wine.price_data.excluded.outside_bottling).toBe(4)
    expect(body.wine.bottling_prompt).toBeNull()
    expect(body.result.tier).toBe('2')
  })

  it('"Plain" is refused for a wine that records a vineyard', async () => {
    const w = await viettiWine()
    await storage.updateWine(w.id, { vineyard: 'Rocche' })
    const res = await choose(w.id, { choice: 'plain' })
    expect(res.status).toBe(409)
  })

  it('"Not sure": changes nothing about the data, excludes nothing, and the prompt stays quiet until the modifiers change', async () => {
    const w = await viettiWine()
    const body = await asJson(await choose(w.id, { choice: 'not_sure' }))
    expect(body.wine.bottling_prompt).toBeNull()
    expect(body.wine.vineyard).toBeNull()
    expect(body.wine.price_data.headline_basis).toBe('ambiguous')
    expect(body.wine.price_data.excluded.outside_bottling).toBe(0)
    // A refresh that brings a new modifier asks again.
    const fresh = await storage.getWine(w.id)
    await storage.updateWine(w.id, {
      price_data: { ...fresh!.price_data!, retailers: [...fresh!.price_data!.retailers, listing('x', 'Vietti Barolo Ravera 2021', 260)] },
    })
    expect((await storage.getWine(w.id))!.bottling_prompt).not.toBeNull()
  })

  it('a typed name that matches nothing found leaves the wine at its current tier and says so', async () => {
    const w = await viettiWine()
    const body = await asJson(await choose(w.id, { choice: 'cuvee', name: 'Zzyzx' }))
    expect(body.wine.cuvee).toBe('Zzyzx')
    expect(body.result.tier).toBe('3a')
    expect(body.wine.price_data.headline_basis).toBe('none')
  })

  it('reports a possible duplicate when the new name matches another cellar wine, without acting on it', async () => {
    const w = await viettiWine()
    const other = await storage.createWine({ ...VIETTI, vineyard: 'Castiglione' })
    await storage.updateWine(other.id, { promoted_at: '2026-10-01T00:00:00.000Z' })
    const body = await asJson(await choose(w.id, { choice: 'vineyard', name: 'Castiglione' }))
    expect(body.result.duplicate.kind).not.toBe('none')
    expect(await storage.getWine(other.id)).not.toBeNull()
  })

  it('validates the body and the wine', async () => {
    const w = await viettiWine()
    expect((await choose(w.id, { choice: 'vineyard' })).status).toBe(400)
    expect((await choose(w.id, { choice: 'wat' })).status).toBe(400)
    expect((await choose('missing', { choice: 'plain' })).status).toBe(404)
  })

  it('PATCH naming a vineyard clears a stored "plain" answer', async () => {
    const w = await viettiWine()
    await choose(w.id, { choice: 'plain' })
    const res = await fetch(`${base}/wines/${w.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vineyard: 'Rocche' }) })
    expect((await asJson(res)).bottling_plain).toBeNull()
  })
})
