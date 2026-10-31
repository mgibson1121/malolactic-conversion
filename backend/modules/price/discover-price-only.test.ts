import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { discoverPriceOnlyRetailers, PRICE_DISCOVERY_MAX_VARIANTS } from './discover-price-only'
import { findProductPageDetailed } from '../reviews/find-product-page'
import { scoreMatch } from '@shared/utils/wine-match'

jest.mock('../reviews/find-product-page', () => ({ findProductPageDetailed: jest.fn() }))
const mockFind = findProductPageDetailed as jest.MockedFunction<typeof findProductPageDetailed>

const laCrau = { producer: 'Domaine du Vieux Télégraphe', denomination: 'Châteauneuf-du-Pape', vintage: 2019, cuvee: 'La Crau', vineyard: null, quality_classification: null, wine_color: 'red' as const }
const KL_URL = 'https://shop.kermitlynch.com/product/detail/19FVT02'
const KL_TITLE = '2019 Châteauneuf-du-Pape “La Crau” Domaine du Vieux Télégraphe'
const KL_HTML = `<title>${KL_TITLE} - Kermit Lynch Wine Merchant</title><h1>${KL_TITLE}</h1> Discount Eligible $105.00 SOLD OUT`

const found = (url: string, title: string) =>
  ({ url, stage: 'found', variantsTried: 1, match: scoreMatch({ title, url }, laCrau), rejected: [], candidates: [] }) as never
const nothing = { url: null, stage: 'zero_results', variantsTried: 2, match: null, rejected: [], candidates: [] } as never
const openai = (content: string) => ({ chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content } }] }) } } }) as never

beforeEach(() => mockFind.mockReset())

describe('Price for shops Google Shopping does not list (Phase 12.4 WI-2, option a)', () => {
  it('2019 La Crau: Kermit Lynch’s own page is found, priced, tagged exact vintage, and sold out (shown, never counted)', async () => {
    mockFind.mockImplementation(async (_w, shop) => (shop.slug === 'kermitlynch' ? found(KL_URL, KL_TITLE) : nothing))
    const render = jest.fn().mockResolvedValue(KL_HTML)
    const [kl, ...rest] = await discoverPriceOnlyRetailers(laCrau, RETAILER_CONFIG, new Set(), 'key', openai('{"price": 105, "sold_out": true}'), render)
    expect(rest).toEqual([])
    expect(kl).toMatchObject({
      slug: 'kermitlynch', name: 'Kermit Lynch Wine Merchant', price: 105, url: KL_URL,
      matched_vintage: 2019, vintage_mismatch: false, vintage_verdict: 'match',
      is_preferred_retailer: true, is_search_results_page: false, link_only: false, verification: 'verified', sold_out: true,
    })
    expect(kl.bottling_difference).toEqual({ extra: [], missing: [], colour: null })
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('searches only the price-only shops, at most two query variants each, with their own accounting label', async () => {
    mockFind.mockResolvedValue(nothing)
    await discoverPriceOnlyRetailers(laCrau, RETAILER_CONFIG, new Set(), 'key', null, jest.fn())
    expect(mockFind.mock.calls.map(c => c[1].slug).sort()).toEqual(['astor', 'kermitlynch'])
    for (const call of mockFind.mock.calls) {
      expect(call[3]).toBe(`price:discovery:${call[1].slug}`)
      expect(call[4]).toBe(PRICE_DISCOVERY_MAX_VARIANTS)
    }
  })

  it('a shop the Shopping pass already brought in is not searched again', async () => {
    mockFind.mockResolvedValue(nothing)
    await discoverPriceOnlyRetailers(laCrau, RETAILER_CONFIG, new Set(['astor', 'kermitlynch']), 'key', null, jest.fn())
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('a page found but unreadable is kept as an unpriced link to the product; no page adds nothing', async () => {
    mockFind.mockImplementation(async (_w, shop) => (shop.slug === 'kermitlynch' ? found(KL_URL, KL_TITLE) : nothing))
    const [kl] = await discoverPriceOnlyRetailers(laCrau, RETAILER_CONFIG, new Set(), 'key', null, jest.fn().mockResolvedValue(null))
    expect(kl).toMatchObject({ slug: 'kermitlynch', price: null, link_only: true, url: KL_URL, verification: 'unverified' })
  })

  it('a Blanc page for the red is kept out of the average (colour)', async () => {
    const title = '2019 Châteauneuf-du-Pape Blanc “La Crau” Domaine du Vieux Télégraphe'
    mockFind.mockImplementation(async (_w, shop) => (shop.slug === 'kermitlynch' ? found(KL_URL, title) : nothing))
    const [kl] = await discoverPriceOnlyRetailers(laCrau, RETAILER_CONFIG, new Set(), 'key', openai('{"price": 95, "sold_out": false}'),
      jest.fn().mockResolvedValue(`<title>${title} - Kermit Lynch Wine Merchant</title><h1>${title}</h1> $95.00`))
    expect(kl.outside_bottling).toBe(true)
    expect(kl.bottling_difference?.colour).toEqual({ stated: 'blanc', wine: 'red' })
  })
})
