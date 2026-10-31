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
import { buildBottlingPrompt, bottlingOptions } from '@shared/utils/bottling-prompt'
import { bottlingChoiceUpdates, rescoreListings } from '@shared/utils/bottling-choice'
import { bottlingDifference, isExactBottling } from '@shared/utils/bottling-difference'
import { buildReviewLadder, SIMILAR_VINTAGE_YEARS } from '@shared/utils/review-ladder'
import { extractPackFormat } from '../../modules/price/pack-format'
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

describe('WI-1 — one ±3-year window for what is displayed', () => {
  it.failing('Sansonnet 2017 does not display the 2005 page’s scores', () => {
    const summary = buildCriticSummary([stored(SANSONNET.page)], SANSONNET.wine.vintage, undefined, SANSONNET.wine)
    expect(summary.ordered).toEqual([])
  })

  it.failing('the Vieux Télégraphe blanc 2012 does not display the 2023 page (11 years away)', () => {
    const w = VIEUX_TELEGRAPHE_BLANC
    const summary = buildCriticSummary([stored(w.page)], w.wine.vintage, undefined, w.wine)
    expect(summary.ordered.every(s => s.vintage == null || Math.abs(s.vintage - w.wine.vintage!) <= SIMILAR_VINTAGE_YEARS)).toBe(true)
  })

  it('today: both are stored and ranked, never rejected (the pipeline keeps recording every gap)', () => {
    const ladder = buildReviewLadder([stored(VIEUX_TELEGRAPHE_BLANC.page)], VIEUX_TELEGRAPHE_BLANC.wine)
    expect(ladder.pages[0].vintage_delta).toBe(11)
    expect(ladder.tier).toBe('2')
  })
})

describe('WI-4 — a bottling answer sticks (Domaine du Pavillon)', () => {
  const before = { ...PAVILLON.wine }
  const reviews = [stored(PAVILLON.page)]
  const prices = priceData(PAVILLON.listings)

  it('the prompt is raised on the stored data; the owner’s name and the URL’s path words come through as an option', () => {
    const names = bottlingOptions({ wine: before, price_data: prices, review_data: reviews }).map(o => o.name.toLowerCase())
    expect(names.sort()).toEqual(['name albert bichot rugiens guest', 'rugiens'])
  })

  it.failing('answering does not bring the banner straight back', () => {
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

  it.todo('2019 La Crau: name the stage that dropped Kermit Lynch — needs the raw Shopping response (one live query, ~1 credit)')

  it('Astor’s Littorai is the plain Sonoma Coast, a different bottling from the Hirsch Vineyard recorded', () => {
    const d = bottlingDifference({ title: LITTORAI.astor.title }, LITTORAI.wine)
    expect(isExactBottling(d)).toBe(false)
    expect(d.missing.join(' ')).toMatch(/hirsch/)
  })
})
