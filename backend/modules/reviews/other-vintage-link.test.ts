import { nearestOtherVintageLink } from './other-vintage-link'

const page = 'https://whwc.com/de-villaine-rully-1er-cru-blanc-rabource-2023/'
const html = (...hrefs: string[]) => `<html><body>${hrefs.map(h => `<a href="${h}">x</a>`).join('')}</body></html>`

describe('nearestOtherVintageLink (Phase 12.2 D12)', () => {
  it('picks the same-family link whose year is nearest the wine and nearer than this page', () => {
    const h = html(
      '/de-villaine-rully-1er-cru-blanc-rabource-2018/',
      '/de-villaine-rully-1er-cru-blanc-rabource-2021/',
      '/de-villaine-rully-1er-cru-blanc-rabource-2022/'
    )
    expect(nearestOtherVintageLink(h, page, 2020)).toBe('https://whwc.com/de-villaine-rully-1er-cru-blanc-rabource-2021/')
  })

  it('ignores other products, other sites, and years no nearer than this page', () => {
    const h = html(
      '/some-other-wine-2020/',
      'https://elsewhere.com/de-villaine-rully-1er-cru-blanc-rabource-2020/',
      '/de-villaine-rully-1er-cru-blanc-rabource-2025/'
    )
    expect(nearestOtherVintageLink(h, page, 2023)).toBeNull()
    expect(nearestOtherVintageLink(h, page, 2020)).toBeNull()
  })

  it('needs exactly one year in the page path to swap', () => {
    expect(nearestOtherVintageLink(html('/x-2019/'), 'https://whwc.com/no-year-here/', 2019)).toBeNull()
    expect(nearestOtherVintageLink(html('/x-2019-2020/'), 'https://whwc.com/x-2019-2021/', 2020)).toBeNull()
  })

  it('resolves absolute links on the same host and ignores unparseable ones', () => {
    const h = html('https://whwc.com/de-villaine-rully-1er-cru-blanc-rabource-2019/?utm=1', 'javascript:void(0)')
    expect(nearestOtherVintageLink(h, page, 2019)).toBe('https://whwc.com/de-villaine-rully-1er-cru-blanc-rabource-2019/')
  })
})
