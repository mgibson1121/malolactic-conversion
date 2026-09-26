import type { PriceData } from '@shared/types'
import { claimPriceOnce, resetPriceOnce } from './priceOnce'

beforeEach(() => resetPriceOnce())

describe('claimPriceOnce', () => {
  it('claims an unpriced wine exactly once per session, even if that fetch failed', () => {
    expect(claimPriceOnce({ id: 'w1', price_data: null })).toBe(true)
    expect(claimPriceOnce({ id: 'w1', price_data: null })).toBe(false)
  })

  it('never claims a wine that already has price data', () => {
    expect(claimPriceOnce({ id: 'w2', price_data: {} as PriceData })).toBe(false)
  })

  it('tracks wines independently', () => {
    expect(claimPriceOnce({ id: 'a', price_data: null })).toBe(true)
    expect(claimPriceOnce({ id: 'b', price_data: null })).toBe(true)
  })
})
