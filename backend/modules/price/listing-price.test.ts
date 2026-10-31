import { pageTitle, readListingPrice, structuredPrice, titleAnchoredExcerpt } from './listing-price'

// Shapes taken from the pages rendered 2026-10-31 (Phase 12.4 WI-2), trimmed.
const ASTOR = `<html><head><title>Littorai Pinot Noir, Sonoma Coast | Astor Wines &amp; Spirits</title>
<script type="application/ld+json">{ "@context": "https://schema.org", "@type": "LiquorStore", "name": "Astor Wines & Spirits" }</script>
<script type="application/ld+json">{ "@context": "http://schema.org", "@type": "Product", "name": "Littorai Pinot Noir, Sonoma Coast", "sku": "31372",
  "offers": { "@type": "Offer", "priceCurrency": "USD", "price": "84.99", "availability": "InStock" } }</script></head><body>…</body></html>`

const KERMIT = `<html><head><title>2019 Châteauneuf-du-Pape “La Crau” Domaine du Vieux Télégraphe - Kermit Lynch Wine Merchant</title></head><body>
<nav>Anniversary Sale! <p class="thumb-price">$26</p> <p class="thumb-price">$65</p></nav>
<h1>2019 Châteauneuf-du-Pape “La Crau” Domaine du Vieux Télégraphe</h1><p>Discount Eligible <span class="actual-price">$105.00</span> SOLD OUT</p>
<section>2024 Châteauneuf-du-Pape “La Crau” Domaine du Vieux Télégraphe … Discount Eligible $145.00</section></body></html>`

describe('Reading a price-only shop’s own product page (Phase 12.4 WI-2)', () => {
  it('takes the page’s own name from <title>, without the shop', () => {
    expect(pageTitle(ASTOR)).toBe('Littorai Pinot Noir, Sonoma Coast')
    expect(pageTitle(KERMIT)).toBe('2019 Châteauneuf-du-Pape “La Crau” Domaine du Vieux Télégraphe')
  })

  it('reads a schema.org offer exactly, with no model call (Astor)', async () => {
    expect(structuredPrice(ASTOR)).toEqual({ price: 84.99, sold_out: false })
    const openai = { chat: { completions: { create: jest.fn() } } }
    expect(await readListingPrice(ASTOR, openai as never)).toEqual({ price: 84.99, sold_out: false, title: 'Littorai Pinot Noir, Sonoma Coast', source: 'structured' })
    expect(openai.chat.completions.create).not.toHaveBeenCalled()
  })

  it('sends the text around the wine’s own title — not the sale menu at the top of the page (Kermit Lynch)', () => {
    const excerpt = titleAnchoredExcerpt(KERMIT, pageTitle(KERMIT)!)
    expect(excerpt).toContain('$105.00 SOLD OUT')
    expect(excerpt).not.toContain('$26')
  })

  it('without structured data, asks once and reads the answer', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: '{"price": 105, "sold_out": true}' } }] })
    const r = await readListingPrice(KERMIT, { chat: { completions: { create } } } as never)
    expect(r).toEqual({ price: 105, sold_out: true, title: '2019 Châteauneuf-du-Pape “La Crau” Domaine du Vieux Télégraphe', source: 'page_text' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a failed or unreadable answer is no price, never a guess', async () => {
    const create = jest.fn().mockRejectedValue(new Error('429'))
    expect((await readListingPrice(KERMIT, { chat: { completions: { create } } } as never)).price).toBeNull()
    expect((await readListingPrice(KERMIT, null)).price).toBeNull()
  })
})
