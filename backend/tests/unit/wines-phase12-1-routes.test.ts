/**
 * Phase 12.1 route behaviour against a real in-memory SQLite adapter:
 * manual price validation, clearing a manual window, stamping enrichment on
 * an identity edit, and deleting a wine that has tasting notes.
 */
import express from 'express'
import Database from 'better-sqlite3'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { SQLiteAdapter } from '../../modules/storage/sqlite-adapter'
import type { CreateWineInput, PriceData } from '@shared/types'
import { identityKey } from '@shared/utils/wine-match'
import { review, score } from '../helpers/review-fixtures'

let storage: SQLiteAdapter
jest.mock('../../modules/storage', () => ({ getStorage: () => storage }))

import winesRouter from '../../routes/wines'
import tastingNotesRouter from '../../routes/tasting-notes'

let server: Server
let base: string

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/wines', winesRouter)
  app.use('/api/tasting-notes', tastingNotesRouter)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
})
afterAll(() => new Promise((resolve) => server.close(resolve)))
beforeEach(() => {
  storage = new SQLiteAdapter(new Database(':memory:'))
})

const WINE: CreateWineInput = {
  producer: 'Marcoux', vintage: 2019, region: 'Rhône', denomination: 'Châteauneuf-du-Pape',
  grape_varieties: null, label_image_url: null,
  tag_discovered: false, tag_wishlist: false, tag_cellar: true, tag_consumed: false,
  cellar_quantity: 2, cellar_category: null, drinking_window: null,
  vintage_rating: null, my_rating: null, my_tags: [], wishlist_notes: null,
  price_paid: null, purchased_from: null, date_first_consumed: null,
  quality_classification: null, vineyard: null, cuvee: null, wine_color: 'red',
}

const PRICE: PriceData = {
  price_min: 60, price_avg: 70, price_max: 80, other_vintage_price_range: null,
  retailers: [], nearest_retailer: null, fetched_at: '2026-10-01T00:00:00.000Z',
}

async function savedWine(extra: Parameters<SQLiteAdapter['updateWine']>[1] = {}) {
  const w = await storage.createWine(WINE)
  return storage.updateWine(w.id, { promoted_at: '2026-10-01T00:00:00.000Z', ...extra })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asJson = (r: Response) => r.json() as Promise<any>

async function patchJson(id: string, body: unknown) {
  return asJson(await patch(id, body))
}

function patch(id: string, body: unknown) {
  return fetch(`${base}/wines/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('PATCH manual_price (D12)', () => {
  it('sets, reads back and clears a manual price', async () => {
    const w = await savedWine()
    let res = await patch(w.id, { manual_price: 85.5 })
    expect(res.status).toBe(200)
    expect((await asJson(res)).manual_price).toBe(85.5)
    res = await patch(w.id, { manual_price: null })
    expect((await asJson(res)).manual_price).toBeNull()
  })

  it.each([0, -5, 12.345, 'abc'])('rejects %p', async (bad) => {
    const w = await savedWine()
    const res = await patch(w.id, { manual_price: bad })
    expect(res.status).toBe(400)
    expect((await storage.getWine(w.id))!.manual_price).toBeNull()
  })

  it('leaves manual_price alone when the key is absent', async () => {
    const w = await savedWine({ manual_price: 40 })
    await patch(w.id, { cellar_quantity: 3 })
    expect((await storage.getWine(w.id))!.manual_price).toBe(40)
  })
})

describe('PATCH drinking_window (manual primary window)', () => {
  it('a set window is manual', async () => {
    const w = await savedWine()
    const body = await patchJson(w.id, { drinking_window: { start: '2030-01-01', end: '2040-01-01' } })
    expect(body.drinking_window_source).toBe('manual')
    expect(body.window_status).toBe('primary')
  })

  it('clearing it hands the wine back to the critics: disagreement → check, no fetch', async () => {
    const w = await savedWine({
      drinking_window: { start: '2030-01-01', end: '2040-01-01' },
      drinking_window_source: 'manual',
      review_data: [
        review('a', 2019, [score('Vinous', 93, { window: [2025, 2035] })]),
        review('b', 2019, [score('Burghound', 91, { window: [2030, 2045] })]),
      ],
    })
    const body = await patchJson(w.id, { drinking_window: null })
    expect(body.drinking_window).toBeNull()
    expect(body.window_status).toBe('check')
  })

  it('clearing it re-derives from agreeing critics', async () => {
    const w = await savedWine({
      drinking_window: { start: '2030-01-01', end: '2040-01-01' },
      drinking_window_source: 'manual',
      review_data: [review('a', 2019, [score('Vinous', 93, { window: [2025, 2035] })])],
    })
    const body = await patchJson(w.id, { drinking_window: null })
    expect(body.drinking_window).toEqual({ start: '2025-01-01', end: '2035-01-01' })
    expect(body.drinking_window_source).toBe('derived')
    expect(body.window_status).toBe('primary')
  })

  it('clearing with no critic windows leaves no window and no source', async () => {
    const w = await savedWine({ drinking_window: { start: '2030-01-01', end: '2040-01-01' }, drinking_window_source: 'manual' })
    const body = await patchJson(w.id, { drinking_window: null })
    expect(body.drinking_window).toBeNull()
    expect(body.drinking_window_source).toBeNull()
    expect(body.window_status).toBe('none')
  })
})

describe('PATCH identity edit stamps enrichment (WI-1)', () => {
  it('stamps unstamped data with the identity it was fetched for, so a declined refresh reads stale', async () => {
    const w = await savedWine({ price_data: PRICE, review_data: [review('a', 2019, [score('Vinous', 93)])] })
    const before = identityKey(w)

    const body = await patchJson(w.id, { producer: 'Domaine Marcoux' })

    expect(body.price_data.enriched_for).toBe(before)
    expect(body.review_data[0].enriched_for).toBe(before)
    expect(body.enrichment_stale).toEqual({ price: true, reviews: true })
  })

  it('does not stamp for edits that are not identity', async () => {
    const w = await savedWine({ price_data: PRICE })
    const body = await patchJson(w.id, { cellar_quantity: 6, wine_color: 'white', manual_price: 50 })
    expect(body.price_data.enriched_for).toBeUndefined()
    expect(body.enrichment_stale).toEqual({ price: false, reviews: false })
  })

  it('does not stamp a draft — editing a scan on the review screen is not a stale-data event', async () => {
    const draft = await storage.createWine(WINE)
    await storage.updateWine(draft.id, { price_data: PRICE })
    const body = await patchJson(draft.id, { producer: 'Marcoux Estate' })
    expect(body.price_data.enriched_for).toBeUndefined()
  })

  it('keeps an existing stamp (a second edit does not overwrite what the data was fetched for)', async () => {
    const w = await savedWine({ price_data: { ...PRICE, enriched_for: 'the-original-identity' } })
    const body = await patchJson(w.id, { vintage: 2020 })
    expect(body.price_data.enriched_for).toBe('the-original-identity')
  })

  it('a casing-only change is not an identity change', async () => {
    const w = await savedWine({ price_data: PRICE })
    const body = await patchJson(w.id, { producer: 'MARCOUX' })
    expect(body.price_data.enriched_for).toBeUndefined()
  })
})

describe('DELETE /api/wines/:id (WI-3)', () => {
  async function wineWithNotes(n: number) {
    const w = await savedWine()
    for (let i = 0; i < n; i++) {
      await storage.createTastingNote({
        wine_id: w.id, tasted_at: `2026-10-0${i + 1}T20:00:00.000Z`, clarity: null, colour_intensity: null, colour: null,
        nose_condition: null, nose_intensity: null, nose_primary_aromas: [], nose_secondary_aromas: [], nose_tertiary_aromas: [],
        palate_sweetness: null, palate_acidity: null, palate_tannin: null, palate_body: null, palate_flavour_intensity: null,
        palate_finish: null, quality_assessment: null, my_rating: 'good', free_text: `note ${i}`, tags: [],
      })
    }
    return w
  }

  it('no longer refuses a wine with tasting notes; the notes stay, detached', async () => {
    const w = await wineWithNotes(2)
    const res = await fetch(`${base}/wines/${w.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await storage.getWine(w.id)).toBeNull()

    const notes = await asJson(await fetch(`${base}/tasting-notes`))
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatchObject({ wine_id: null, wine_removed: true, wine_producer: 'Marcoux', wine_vintage: 2019 })
  })

  it('?dry_run=1 reports how many notes would be kept and deletes nothing', async () => {
    const w = await wineWithNotes(2)
    const res = await fetch(`${base}/wines/${w.id}?dry_run=1`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ notes_kept: 2 })
    expect(await storage.getWine(w.id)).not.toBeNull()
  })

  it('404s for an unknown wine', async () => {
    expect((await fetch(`${base}/wines/nope`, { method: 'DELETE' })).status).toBe(404)
  })
})
