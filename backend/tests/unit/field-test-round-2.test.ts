/**
 * The 2026-10-31 field-test cases (Phase 12.4 WI-0), replayed offline from the
 * data stored that day. A case that is still open is `it.failing`: it states
 * the behaviour the spec asks for and passes once that work item lands — at
 * which point Jest reports it, and it becomes a plain `it`.
 *
 * Fixtures: backend/tests/fixtures/ground-truth-wines.ts (field-test round 2).
 */
import type { PriceData, RetailerPrice, RetailerReview } from '@shared/types'
import { buildCriticSummary } from '@shared/utils/critic-summary'
import { buildBottlingAnswer, buildBottlingPrompt, bottlingOptions } from '@shared/utils/bottling-prompt'
import { bottlingChoiceUpdates, rescoreListings } from '@shared/utils/bottling-choice'
import { bottlingDifference, isExactBottling } from '@shared/utils/bottling-difference'
import { buildReviewLadder, SIMILAR_VINTAGE_YEARS } from '@shared/utils/review-ladder'
import { priceWindowOf } from '@shared/utils/price-window'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { extractPackFormat } from '../../modules/price/pack-format'
import { querySerper } from '../../modules/price/serper-query'
import fs from 'fs'
import path from 'path'
import { BALTHAZAR, LA_CRAU_2019, LITTORAI, PAVILLON, SANSONNET, VIEUX_TELEGRAPHE_BLANC } from '../fixtures/ground-truth-wines'

type Page = { slug: string; name: string; page_vintage: number; product_url: string; scores?: Array<{ publication: string; score: number }> }

function stored(page: Page): RetailerReview {
  return {
    slug: page.slug, name: page.name, product_url: page.product_url, page_vintage: page.page_vintage,
    critic_scores: (page.scores ?? []).map(s => ({ ...s, known_publication: true, drinking_window: null, vintage_character: null, deal: false })),
    fetched_at: '2026-10-31T00:00:00.000Z', source: 'configured', page_bottling: null, page_price: null,
  } as unknown as RetailerReview
}

/** Listings exactly as the fetch stored them: title plus the bottling difference recorded at fetch time. */
function priceData(listings: Array<{ title: string; extra: string[] }>): PriceData {
  return {
    price_min: null, price_avg: null, price_max: null, other_vintage_price_range: null, nearest_retailer: null,
    fetched_at: '2026-10-31T00:00:00.000Z',
    retailers: listings.map((l, i) => ({
      slug: `r${i}`, name: `R${i}`, url: `https://example.com/${i}`, price: 100, listing_title: l.title,
      bottling_difference: { extra: l.extra, missing: [] }, outside_bottling: l.extra.length > 0,
    }) as unknown as RetailerPrice),
  } as PriceData
}

const laCrauShopping: { shopping: Array<{ title: string; source: string; price?: string; link?: string }> } =
  JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/serper-shopping-la-crau-2019.json'), 'utf8'))

describe('WI-1 — one ±3-year window for what is displayed', () => {
  it('Sansonnet 2017 does not display the 2005 page’s scores', () => {
    const summary = buildCriticSummary([stored(SANSONNET.page)], SANSONNET.wine.vintage, undefined, SANSONNET.wine)
    expect(summary.ordered).toEqual([])
  })

  it('the Vieux Télégraphe blanc 2012 does not display the 2023 page (11 years away)', () => {
    const w = VIEUX_TELEGRAPHE_BLANC
    const summary = buildCriticSummary([stored(w.page)], w.wine.vintage, undefined, w.wine)
    expect(summary.ordered.every(s => s.vintage == null || Math.abs(s.vintage - w.wine.vintage!) <= SIMILAR_VINTAGE_YEARS)).toBe(true)
  })

  it('the page is still on the ladder with its gap recorded, but it no longer sets a tier', () => {
    const ladder = buildReviewLadder([stored(VIEUX_TELEGRAPHE_BLANC.page)], VIEUX_TELEGRAPHE_BLANC.wine)
    expect(ladder.pages[0].vintage_delta).toBe(11)
    expect(ladder.pages[0].rung).toBe('out')
    expect(ladder.tier).toBe('none')
  })

  it('a page exactly 3 vintages away is shown; 4 away is not', () => {
    const at = (page_vintage: number) => buildCriticSummary([stored({ ...SANSONNET.page, page_vintage })], 2017, undefined, SANSONNET.wine).ordered.length
    expect(at(2014)).toBe(2)
    expect(at(2020)).toBe(2)
    expect(at(2013)).toBe(0)
    expect(at(2021)).toBe(0)
  })

  it('price rows: 3 years away shown, 4 hidden, nothing removed from price_data', () => {
    const data = {
      price_min: null, price_avg: null, price_max: null, other_vintage_price_range: { min: 90, max: 300 }, nearest_retailer: null, fetched_at: '2026-10-31T00:00:00.000Z',
      retailers: [
        { slug: 'near', matched_vintage: 2015, vintage_mismatch: true, price: 90, non_standard_format: false },
        { slug: 'far', matched_vintage: 2016, vintage_mismatch: true, price: 300, non_standard_format: false },
        { slug: 'unknown', matched_vintage: null, vintage_mismatch: false, price: 120, non_standard_format: false },
      ],
    } as unknown as PriceData
    expect(priceWindowOf(data, 2012)).toEqual({ hidden: ['far'], other_vintage_price_range: { min: 90, max: 90 } })
    expect(data.retailers).toHaveLength(3)
    expect(priceWindowOf(data, null)!.hidden).toEqual([])
  })
})

describe('WI-4 — a bottling answer sticks (Domaine du Pavillon)', () => {
  const before = { ...PAVILLON.wine }
  const reviews = [stored(PAVILLON.page)]
  const prices = priceData(PAVILLON.listings)

  it('the URL’s path words ("name", "guest") no longer become an option; the owner’s name still rides along with the vineyard', () => {
    const names = bottlingOptions({ wine: before, price_data: prices, review_data: reviews }).map(o => o.name.toLowerCase())
    expect(names).toEqual(['albert bichot rugiens'])
  })

  it('answering does not bring the banner straight back', () => {
    const updates = bottlingChoiceUpdates({ ...before, price_data: prices, review_data: reviews } as never, { choice: 'vineyard', name: PAVILLON.answer })
    const after = { ...before, ...updates }
    // What POST /:id/choose-bottling does next: re-score the stored listings locally.
    const rescored = { ...prices, retailers: rescoreListings(prices.retailers, after, true) }
    const prompt = buildBottlingPrompt({
      wine: after, price_data: rescored, review_data: reviews,
      review_ladder: buildReviewLadder(reviews, after),
      bottling_plain: updates.bottling_plain, bottling_prompt_dismissed: updates.bottling_prompt_dismissed,
    })
    expect(prompt).toBeNull()
  })
})

describe('WI-4 — Pavillon as it stands after the 2026-10-31 Edit (vineyard Les Rugiens, the old answer kept)', () => {
  const now = { ...PAVILLON.wine, vineyard: 'Les Rugiens' }
  const reviews = [stored(PAVILLON.page)]
  const prices = priceData(PAVILLON.listings)
  const input = {
    wine: now, price_data: prices, review_data: reviews, review_ladder: buildReviewLadder(reviews, now),
    bottling_plain: null, bottling_prompt_dismissed: 'albert bichot|name albert bichot guest|albert bichot',
  }

  it('asks nothing: the stored listing differences ("rugiens") are re-judged against the wine as it is now', () => {
    expect(buildBottlingPrompt(input)).toBeNull()
  })

  it('shows the quiet answered row instead, with the options for Change', () => {
    const answer = buildBottlingAnswer(input, null)
    expect(answer?.label).toBe('Les Rugiens')
    expect(answer?.options.map(o => o.name)).toEqual(['Albert Bichot'])
  })

  it('no row for a wine that was never answered, or answered "Not sure" with nothing recorded', () => {
    expect(buildBottlingAnswer({ ...input, bottling_prompt_dismissed: null }, null)).toBeNull()
    expect(buildBottlingAnswer({ ...input, wine: { ...now, vineyard: null } }, null)).toBeNull()
  })
})

describe('WI-5 — 1.5L shown as 12L (Franck Balthazar)', () => {
  it('current code reads Crush’s magnum as 1.5L; the stored "12L" predates #44 and needs a re-fetch', () => {
    const f = extractPackFormat(BALTHAZAR.crushTitle, [BALTHAZAR.wine.producer, BALTHAZAR.wine.cuvee, BALTHAZAR.wine.vineyard])
    expect(f.bottle_size_ml).toBe(1500)
  })
})

describe('WI-2 — retailers the developer shops at', () => {
  it('Kermit Lynch’s page is the exact wine and vintage', () => {
    const d = bottlingDifference({ title: LA_CRAU_2019.kermitLynch.title, url: LA_CRAU_2019.kermitLynch.url }, LA_CRAU_2019.wine)
    expect(isExactBottling(d)).toBe(true)
  })

  describe('2019 La Crau — the live Shopping response (2026-10-31, one query)', () => {
    const realFetch = global.fetch
    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ shopping: laCrauShopping.shopping }) }) as never
    })
    afterEach(() => { global.fetch = realFetch })
    const run = () => querySerper('Domaine du Vieux Telegraphe Chateauneuf-du-Pape La Crau 2019', RETAILER_CONFIG, 'stub', LA_CRAU_2019.wine, 'Domaine du Vieux Telegraphe Chateauneuf-du-Pape La Crau')

    it('Kermit Lynch is not in the response at all (cause 1): nothing in the app dropped it', () => {
      expect(laCrauShopping.shopping.some(i => /kermit/i.test(i.source))).toBe(false)
    })

    it('with the wine’s colour recorded (red), no La Crau Blanc listing is counted', async () => {
      const { retailers } = await querySerper('Domaine du Vieux Telegraphe Chateauneuf-du-Pape La Crau 2019', RETAILER_CONFIG, 'stub', { ...LA_CRAU_2019.wine, wine_color: 'red' }, 'Domaine du Vieux Telegraphe Chateauneuf-du-Pape La Crau')
      const blanc = retailers.filter(r => /blanc/i.test(r.listing_title ?? ''))
      expect(blanc.every(r => r.outside_bottling === true)).toBe(true)
      expect(retailers.filter(r => !r.outside_bottling).every(r => !/blanc/i.test(r.listing_title ?? ''))).toBe(true)
    })

    it('the top-up keeps exact-vintage listings that Serper sent without a `link` (the fallback never uses it)', async () => {
      const { retailers } = await run()
      expect(retailers.map(r => r.name)).toEqual(expect.arrayContaining(['CaskCartel.com', 'Tribeca Wine Merchants']))
      expect(retailers.filter(r => r.matched_vintage == null)).toEqual([])
    })
  })

  it('"750 mL | 6 bottles" is read as a six-pack (BlockCellar, same response)', () => {
    const f = extractPackFormat('Vieux Telegraphe La Crau Rouge Chateauneuf-du-Pape 2019 | 750 mL | 6 bottles', [LA_CRAU_2019.wine.producer, LA_CRAU_2019.wine.cuvee])
    expect(f.pack_quantity).toBe(6)
  })

  it('Astor’s Littorai is the plain Sonoma Coast, a different bottling from the Hirsch Vineyard recorded', () => {
    const d = bottlingDifference({ title: LITTORAI.astor.title }, LITTORAI.wine)
    expect(isExactBottling(d)).toBe(false)
    expect(d.missing.join(' ')).toMatch(/hirsch/)
  })
})
