import type OpenAI from 'openai'
import { NYC, type RetailerConfig } from '@shared/config/retailers.config'
import { bottlingDifference, type BottlingWine } from '@shared/utils/bottling-difference'
import { findProductPageDetailed } from '../reviews/find-product-page'
import { describeFormat, extractPackFormat, isNonStandardFormat, normalizationFor } from './pack-format'
import { haversineDistanceMiles } from './proximity'
import { readListingPrice } from './listing-price'
import type { RetailerResult } from './types'

/** Query variants a price-only shop may spend: the full identity, then the relaxed producer. */
export const PRICE_DISCOVERY_MAX_VARIANTS = 2

/**
 * Price for configured shops Google Shopping does not list (Phase 12.4 WI-2,
 * developer option (a), 2026-10-31): Kermit Lynch and Astor. For each shop
 * marked `priceDiscovery: 'organic'` that neither the Shopping pass nor a
 * review page already supplied:
 *
 *   1. one `site:` organic search (two at most — PRICE_DISCOVERY_MAX_VARIANTS,
 *      and the second only when the first returns nothing at all), matched
 *      with the same rules as review discovery;
 *   2. one local render of the best product page;
 *   3. its price: the page's structured offer if it has one (free), else one
 *      GPT-4o call on text around the page's own title (listing-price.ts).
 *
 * Arithmetic: +1 Serper search per such shop per price lookup (2 worst case),
 * + 1 render and at most 1 GPT-4o call per shop whose page is found. No review
 * call ever (`reviewTier: 'none'`). A page found but unreadable is kept as a
 * link to the product, unpriced; a shop with no matching page adds nothing.
 */
export async function discoverPriceOnlyRetailers(
  wine: BottlingWine,
  retailers: RetailerConfig[],
  alreadyHave: Set<string>,
  serperKey: string,
  openai: OpenAI | null,
  render: (url: string) => Promise<string | null>
): Promise<RetailerResult[]> {
  const shops = retailers.filter(r => r.priceDiscovery === 'organic' && !alreadyHave.has(r.slug))
  const found = await Promise.all(shops.map(shop => discoverOne(wine, shop, serperKey, openai, render)))
  return found.filter((r): r is RetailerResult => r !== null)
}

async function discoverOne(
  wine: BottlingWine,
  shop: RetailerConfig,
  serperKey: string,
  openai: OpenAI | null,
  render: (url: string) => Promise<string | null>
): Promise<RetailerResult | null> {
  const outcome = await findProductPageDetailed(wine, shop, serperKey, `price:discovery:${shop.slug}`, PRICE_DISCOVERY_MAX_VARIANTS)
  if (!outcome.url || !outcome.match) return null
  const verdict = outcome.match

  const html = await render(outcome.url)
  const listing = html ? await readListingPrice(html, openai) : { price: null, sold_out: false, title: null, source: 'none' as const }
  const title = listing.title ?? undefined
  const ownNames = [wine.producer, wine.cuvee, wine.vineyard]
  const format = extractPackFormat(title ?? '', ownNames)
  const difference = bottlingDifference({ title, url: outcome.url }, wine)

  return {
    slug: shop.slug,
    name: shop.name,
    price: listing.price,
    // The shop's own product page — better than a search link, and the page
    // the price was read from.
    url: outcome.url,
    is_preferred_retailer: true,
    distance_miles: Math.round(haversineDistanceMiles(NYC.lat, NYC.lng, shop.lat, shop.lng)),
    is_search_results_page: false,
    matched_vintage: verdict.candidateVintage,
    vintage_mismatch: verdict.vintage === 'mismatch',
    vintage_verdict: verdict.vintage,
    pack_quantity: format.pack_quantity,
    bottle_size_ml: format.bottle_size_ml,
    non_standard_format: isNonStandardFormat(format),
    format_label: describeFormat(format),
    link_only: listing.price === null,
    // The page was rendered and matched on producer and wine — the strongest
    // check any listing gets. Not a claim about stock: see sold_out.
    verification: html ? 'verified' : 'unverified',
    ...normalizationFor(format, listing.price, 'title'),
    ...(title ? { listing_title: title } : {}),
    bottling_difference: { extra: difference.extra, missing: difference.missing, colour: difference.colour ?? null },
    ...(difference.colour ? { outside_bottling: true } : {}),
    ...(listing.sold_out ? { sold_out: true } : {}),
  }
}

