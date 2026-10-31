import type OpenAI from 'openai'

/**
 * The price a shop's own product page states for its wine (Phase 12.4 WI-2),
 * for shops Google Shopping does not list. Structured data first — a
 * schema.org Product offer is exact and free (Astor carries one) — and only
 * otherwise one GPT-4o call on text taken around the page's own title, never
 * the page head: Kermit Lynch's product page opens with a sale menu of other
 * wines' prices and lists the same cuvée's other vintages beneath it.
 */
export interface ListingPrice {
  price: number | null
  sold_out: boolean
  /** The page's own name for the wine (`<title>` without the shop's suffix). */
  title: string | null
  source: 'structured' | 'page_text' | 'none'
}

const EXCERPT_RADIUS = 250
const EXCERPT_BUDGET = 3000

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&nbsp;/g, ' ')

/** `<title>` without " | Astor Wines & Spirits" / " - Kermit Lynch Wine Merchant". */
export function pageTitle(html: string): string | null {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  if (!raw) return null
  const t = decode(raw).replace(/\s+/g, ' ').trim()
  return t.replace(/\s+[|–-]\s+[^|–-]+$/, '').trim() || null
}

function priceNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/[^0-9.]/g, '')) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** A schema.org Product offer's price and availability, when the page carries one. */
export function structuredPrice(html: string): { price: number; sold_out: boolean } | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try {
      data = JSON.parse(m[1])
    } catch {
      continue
    }
    const nodes = (Array.isArray(data) ? data : [data]).flatMap(d => (d && typeof d === 'object' && '@graph' in d ? (d as { '@graph': unknown[] })['@graph'] : [d]))
    for (const node of nodes as Array<Record<string, unknown>>) {
      if (!node || node['@type'] !== 'Product') continue
      const offers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : []
      for (const offer of offers as Array<Record<string, unknown>>) {
        const price = priceNumber(offer.price ?? offer.lowPrice)
        if (price === null) continue
        const availability = String(offer.availability ?? '')
        return { price, sold_out: /OutOfStock|SoldOut|Discontinued/i.test(availability) }
      }
    }
  }
  return null
}

/** Text around each place the page repeats its own title — where the wine's own price sits. */
export function titleAnchoredExcerpt(html: string, title: string): string {
  const text = decode(
    html
      // <title> too: only the body's own mentions of the wine anchor a window.
      .replace(/<(script|style|svg|template|title)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ')
  const needle = title.toLowerCase()
  const lower = text.toLowerCase()
  const pieces: string[] = []
  let total = 0
  for (let at = lower.indexOf(needle); at >= 0 && total < EXCERPT_BUDGET; at = lower.indexOf(needle, at + needle.length)) {
    const piece = text.slice(at, at + needle.length + EXCERPT_RADIUS)
    pieces.push(piece)
    total += piece.length
  }
  return pieces.join('\n...\n')
}

const SYSTEM =
  'You read an excerpt of a wine shop\'s product page. Return the shop\'s price in US dollars for one standard purchase of the exact wine named, ' +
  'and whether the page says it is sold out or unavailable. The page also lists other wines and other vintages of the same wine with their own prices: ' +
  'ignore them — only the price shown with the named wine and vintage counts. If no price for that exact wine is shown, price is null. ' +
  'Reply with JSON only: {"price": <number|null>, "sold_out": <boolean>}'

export async function readListingPrice(html: string, openai: OpenAI | null): Promise<ListingPrice> {
  const title = pageTitle(html)
  const structured = structuredPrice(html)
  if (structured) return { ...structured, title, source: 'structured' }
  if (!openai || !title) return { price: null, sold_out: false, title, source: 'none' }
  const excerpt = titleAnchoredExcerpt(html, title)
  if (!excerpt) return { price: null, sold_out: false, title, source: 'none' }
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Wine: ${title}\n\nExcerpt:\n${excerpt}` },
      ],
    })
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as { price?: unknown; sold_out?: unknown }
    return { price: priceNumber(parsed.price), sold_out: parsed.sold_out === true, title, source: 'page_text' }
  } catch {
    return { price: null, sold_out: false, title, source: 'none' }
  }
}
