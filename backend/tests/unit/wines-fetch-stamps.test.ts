/**
 * Phase 12.1 (WI-1): a price or review fetch stamps what it was fetched for
 * (`enriched_for`), so a later identity edit that is declined ("Not now") can
 * say the stored data may not match.
 */
import express from 'express'
import Database from 'better-sqlite3'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { SQLiteAdapter } from '../../modules/storage/sqlite-adapter'
import type { CreateWineInput } from '@shared/types'
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
  jest.clearAllMocks()
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

describe('fetch routes stamp the identity they were fetched for', () => {
  it('fetch-price stamps price_data.enriched_for', async () => {
    const wine = await storage.createWine(WINE)
    mockFetchPriceData.mockResolvedValue({ retailers: [] })

    const res = await fetch(`${base}/${wine.id}/fetch-price?force=true`, { method: 'POST' })
    const body = (await res.json()) as { price_data: { enriched_for?: string }; enrichment_stale: { price: boolean } }

    expect(res.status).toBe(200)
    expect(body.price_data.enriched_for).toBe(identityKey(wine))
    expect(body.enrichment_stale.price).toBe(false)
  })

  it('fetch-price stores the whole aggregate — headline_basis, price_groups, excluded survive the write (Phase 12.4 fix)', async () => {
    const wine = await storage.createWine(WINE)
    const listing = (slug: string, price: number) => ({
      slug, name: slug, price, url: `https://example.com/${slug}`, is_preferred_retailer: false, distance_miles: 0,
      is_search_results_page: true, matched_vintage: 2019, vintage_mismatch: false, vintage_verdict: 'match',
      pack_quantity: 1, bottle_size_ml: null, non_standard_format: false, format_label: '', link_only: false, verification: 'unverified',
    })
    // $74.99 vs $245: ≥ 2.5×, so no single average (12.2 D10).
    mockFetchPriceData.mockResolvedValue({ retailers: [listing('a', 74.99), listing('b', 149), listing('c', 245)] })

    const res = await fetch(`${base}/${wine.id}/fetch-price?force=true`, { method: 'POST' })
    expect(res.status).toBe(200)
    const stored = (await storage.getWine(wine.id))!.price_data!
    expect(stored.headline_basis).toBe('ambiguous')
    expect(stored.price_groups).toHaveLength(2)
    expect(stored.excluded).toBeDefined()
    expect(stored.enriched_for).toBe(identityKey(wine))
  })

  it('fetch-reviews stamps every review_data entry, and derives the critic order', async () => {
    const wine = await storage.createWine(WINE)
    mockFetchReviewData.mockResolvedValue([review('a', 2019, [score('Burghound', 91)]), review('b', 2019, [score('Vinous', 93)])])

    const res = await fetch(`${base}/${wine.id}/fetch-reviews?force=true`, { method: 'POST' })
    const body = (await res.json()) as {
      review_data: Array<{ enriched_for?: string }>
      critic_summary: { ordered: Array<{ publication: string }> }
    }

    expect(res.status).toBe(200)
    expect(body.review_data.map((r) => r.enriched_for)).toEqual([identityKey(wine), identityKey(wine)])
    expect(body.critic_summary.ordered.map((i) => i.publication)).toEqual(['Vinous', 'Burghound'])
  })

  it('a fresh fetch after an identity edit replaces the stale stamp', async () => {
    const wine = await storage.createWine(WINE)
    await storage.updateWine(wine.id, {
      promoted_at: '2026-10-01T00:00:00.000Z',
      price_data: { price_min: null, price_avg: null, price_max: null, other_vintage_price_range: null, retailers: [], nearest_retailer: null, fetched_at: '2026-10-01T00:00:00.000Z', enriched_for: 'old-identity' },
    })
    mockFetchPriceData.mockResolvedValue({ retailers: [] })

    const res = await fetch(`${base}/${wine.id}/fetch-price?force=true`, { method: 'POST' })
    const body = (await res.json()) as { price_data: { enriched_for?: string }; enrichment_stale: { price: boolean } }
    expect(body.price_data.enriched_for).toBe(identityKey(wine))
    expect(body.enrichment_stale.price).toBe(false)
  })
})
