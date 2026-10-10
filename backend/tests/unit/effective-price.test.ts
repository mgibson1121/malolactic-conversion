import { effectivePrice } from '@shared/utils/effective-price'
import { enrichmentStale } from '@shared/utils/enrichment-stale'
import { identityKey } from '@shared/utils/wine-match'

describe('effectivePrice (Phase 12.1 D12)', () => {
  it('prefers the manual price over the automated average', () => {
    expect(effectivePrice({ manual_price: 45, price_data: { price_avg: 60 } })).toEqual({ value: 45, basis: 'manual' })
  })
  it('falls back to the automated average', () => {
    expect(effectivePrice({ manual_price: null, price_data: { price_avg: 60 } })).toEqual({ value: 60, basis: 'automated' })
  })
  it('is empty when there is neither', () => {
    expect(effectivePrice({ manual_price: null, price_data: null })).toEqual({ value: null, basis: null })
    expect(effectivePrice({ price_data: { price_avg: null } })).toEqual({ value: null, basis: null })
  })
})

describe('enrichmentStale (Phase 12.1 WI-1)', () => {
  const wine = { producer: 'Marcoux', denomination: 'Châteauneuf-du-Pape', vintage: 2019 }

  it('treats an unstamped blob as unknown, never stale', () => {
    expect(enrichmentStale({ ...wine, price_data: {}, review_data: [{}] })).toEqual({ price: false, reviews: false })
  })
  it('is not stale when the stamp matches the current identity', () => {
    const stamp = identityKey(wine)
    expect(enrichmentStale({ ...wine, price_data: { enriched_for: stamp }, review_data: [{ enriched_for: stamp }] })).toEqual({
      price: false,
      reviews: false,
    })
  })
  it('is stale when the identity changed since the fetch', () => {
    const stamp = identityKey(wine)
    const edited = { ...wine, vintage: 2020 }
    expect(enrichmentStale({ ...edited, price_data: { enriched_for: stamp }, review_data: [{ enriched_for: stamp }] })).toEqual({
      price: true,
      reviews: true,
    })
  })
  it('ignores casing, accents and punctuation', () => {
    expect(identityKey({ producer: 'Château  Montus!', denomination: 'Madiran', vintage: 2018 })).toBe(
      identityKey({ producer: 'chateau montus', denomination: 'MADIRAN', vintage: 2018 })
    )
  })
})
