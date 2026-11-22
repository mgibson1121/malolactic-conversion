import { jobsRunning, mergeEnrichment, priceSearchOf, reviewSearchOf, sameEnrichment } from './enrichmentJob'
import { makeSummaryItem, makeTestPriceData, makeTestRetailer, makeTestWine } from '../test-fixtures'
import type { PriceJob, ReviewsJob } from '@shared/types'

const reviewsJob = (over: Partial<ReviewsJob> = {}): ReviewsJob => ({
  state: 'running', stage: 'shops', started_at: 'a', updated_at: 'b', shops_total: 11, shops_done: 0, scores_found: 0, identity: 'k', ...over,
})
const priceJob = (over: Partial<PriceJob> = {}): PriceJob => ({ state: 'running', started_at: 'a', updated_at: 'b', identity: 'k', ...over })
const wineWith = (reviews?: ReviewsJob | null, price?: PriceJob | null) => makeTestWine({ enrichment_job: { reviews, price } })

describe('reviewSearchOf — what the critic block says about a search (Phase 14 WI-6)', () => {
  it('while running: how far it has got, and how many scores so far', () => {
    const s = reviewSearchOf(wineWith(reviewsJob({ shops_done: 7, scores_found: 2 })), false)
    expect(s.isSearching).toBe(true)
    expect(s.metaLine).toBe('Checked 7 of 11 shops · 2 scores so far')
  })

  it('leaves out "scores so far" until there is one, and says "1 score" in the singular', () => {
    expect(reviewSearchOf(wineWith(reviewsJob({ shops_done: 4 })), false).metaLine).toBe('Checked 4 of 11 shops')
    expect(reviewSearchOf(wineWith(reviewsJob({ shops_done: 1, scores_found: 1 })), false).metaLine).toBe('Checked 1 of 11 shops · 1 score so far')
  })

  it('once done: how many shops it checked', () => {
    const s = reviewSearchOf(wineWith(reviewsJob({ state: 'done', shops_done: 11 })), false)
    expect(s.isSearching).toBe(false)
    expect(s.metaLine).toBe('Checked 11 shops')
  })

  it('nothing found says how hard it looked, with no button to offer', () => {
    expect(reviewSearchOf(wineWith(reviewsJob({ state: 'done', shops_done: 11 })), false).noneLine).toBe('No critic scores found at 11 shops.')
    expect(reviewSearchOf(makeTestWine(), false).noneLine).toBe('No critic scores found.')
    expect(reviewSearchOf(wineWith(reviewsJob({ state: 'done', shops_total: 1, shops_done: 1 })), false).noneLine).toBe('No critic scores found at 1 shop.')
  })

  it('has nothing true to say before the first count, so it says nothing', () => {
    expect(reviewSearchOf(wineWith(reviewsJob({ shops_total: 0 })), false).metaLine).toBeNull()
  })

  it('the count never reads as more than the total', () => {
    expect(reviewSearchOf(wineWith(reviewsJob({ shops_done: 12 })), false).metaLine).toBe('Checked 11 of 11 shops')
  })

  it("this screen's own request counts as searching before the server has said so", () => {
    expect(reviewSearchOf(makeTestWine(), true).isSearching).toBe(true)
  })

  it('a search the server stopped, or could not run, is not searching, and says which', () => {
    const stopped = reviewSearchOf(wineWith(reviewsJob({ state: 'interrupted', shops_done: 3 })), false)
    expect(stopped).toMatchObject({ isSearching: false, isInterrupted: true, hasFailed: false })
    const failed = reviewSearchOf(wineWith(reviewsJob({ state: 'failed' })), false)
    expect(failed).toMatchObject({ isSearching: false, isInterrupted: false, hasFailed: true })
  })
})

describe('priceSearchOf and jobsRunning', () => {
  it('a running price job, or an outstanding request, is searching', () => {
    expect(priceSearchOf(wineWith(null, priceJob()), false).isSearching).toBe(true)
    expect(priceSearchOf(makeTestWine(), true).isSearching).toBe(true)
    expect(priceSearchOf(wineWith(null, priceJob({ state: 'done' })), false).isSearching).toBe(false)
  })

  it('failed or stopped reads as failed unless a lookup is running now', () => {
    expect(priceSearchOf(wineWith(null, priceJob({ state: 'failed' })), false).hasFailed).toBe(true)
    expect(priceSearchOf(wineWith(null, priceJob({ state: 'interrupted' })), false).hasFailed).toBe(true)
    expect(priceSearchOf(makeTestWine(), false, 'Price lookup failed').hasFailed).toBe(true)
    // An error from the last tap does not outrank a lookup that is running now.
    expect(priceSearchOf(wineWith(null, priceJob()), false, 'Price lookup failed').hasFailed).toBe(false)
  })

  it('jobsRunning is true if either lookup is running', () => {
    expect(jobsRunning(makeTestWine())).toBe(false)
    expect(jobsRunning(wineWith(reviewsJob(), null))).toBe(true)
    expect(jobsRunning(wineWith(null, priceJob()))).toBe(true)
    expect(jobsRunning(wineWith(reviewsJob({ state: 'done' }), priceJob({ state: 'failed' })))).toBe(false)
  })
})

describe('mergeEnrichment — a poll brings across what a lookup wrote, and only that', () => {
  it("takes the lookups' fields from the fresh read and leaves the developer's own alone", () => {
    const mine = makeTestWine({ tag_wishlist: true, cellar_quantity: 9, wishlist_notes: 'for autumn', vineyard: 'edit in progress' })
    const fresh = makeTestWine({
      tag_wishlist: false, cellar_quantity: 3, wishlist_notes: null, vineyard: null, // older than my edits
      price_data: makeTestPriceData([makeTestRetailer()]),
      critic_summary: { ordered: [makeSummaryItem({ publication: 'Vinous' })] },
      enrichment_job: { reviews: reviewsJob({ state: 'done' }) },
    })
    const merged = mergeEnrichment(mine, fresh)
    expect(merged.tag_wishlist).toBe(true)
    expect(merged.cellar_quantity).toBe(9)
    expect(merged.wishlist_notes).toBe('for autumn')
    expect(merged.vineyard).toBe('edit in progress')
    expect(merged.price_data).toEqual(fresh.price_data)
    expect(merged.critic_summary).toEqual(fresh.critic_summary)
    expect(merged.enrichment_job?.reviews?.state).toBe('done')
  })

  it('a field the fresh read leaves out is cleared, not kept', () => {
    const mine = makeTestWine({ enrichment_job: { reviews: reviewsJob() } })
    expect(mergeEnrichment(mine, makeTestWine()).enrichment_job).toBeUndefined()
  })

  it('sameEnrichment sees a change in a lookup field and ignores one in a developer field', () => {
    const a = makeTestWine()
    expect(sameEnrichment(a, makeTestWine({ tag_wishlist: true }))).toBe(true)
    expect(sameEnrichment(a, makeTestWine({ enrichment_job: { reviews: reviewsJob() } }))).toBe(false)
    expect(sameEnrichment(a, makeTestWine({ price_data: makeTestPriceData([]) }))).toBe(false)
  })
})
