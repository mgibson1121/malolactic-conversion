import OpenAI from 'openai'
import { Router, Request, Response, NextFunction } from 'express'
import { getStorage } from '../modules/storage'
import { CreateWineSchema, UpdateWineSchema } from '@shared/validation'
import type { RetailerPrice, RetailerReview, UpdateWineInput, WineFilter } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { haversineDistanceMiles } from '@shared/utils/proximity'
import { NYC } from '@shared/config/retailers.config'
import { fetchPriceData, aggregatePriceData } from '../modules/price'
import { getRetailerLinks } from '../modules/retailer-links'
import { fetchReviewData } from '../modules/reviews'
import { renderPageHtml } from '../modules/reviews/puppeteer-extract'
import { extractCandidateText } from '../modules/reviews/keyword-window'
import { extractFromRenderedHtml } from '../modules/reviews/gpt-extract'
import { deriveWineLevelFields } from '../modules/reviews/derive-wine-level'

const router = Router()

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
}

router.post(
  '/',
  wrap(async (req, res) => {
    const result = CreateWineSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: result.error.format() })
      return
    }
    const wine = await getStorage().createWine(result.data)
    res.status(201).json(wine)
  })
)

router.get(
  '/',
  wrap(async (req, res) => {
    const filter: WineFilter = {}
    if (req.query.tag_discovered === 'true') filter.tag_discovered = true
    if (req.query.tag_wishlist === 'true') filter.tag_wishlist = true
    if (req.query.tag_cellar === 'true') filter.tag_cellar = true
    if (req.query.tag_consumed === 'true') filter.tag_consumed = true
    if (req.query.has_tasting_note === 'true') filter.has_tasting_note = true
    if (req.query.my_rating) filter.my_rating = req.query.my_rating as WineFilter['my_rating']
    if (req.query.region) filter.region = String(req.query.region)
    const wines = await getStorage().listWines(filter)
    res.json(wines)
  })
)

router.get(
  '/:id',
  wrap(async (req, res) => {
    const wine = await getStorage().getWine(req.params.id)
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' })
      return
    }
    res.json(wine)
  })
)

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const result = UpdateWineSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: result.error.format() })
      return
    }
    const updates: UpdateWineInput = { ...result.data }
    // A drinking_window/vintage_rating key present in the raw request body
    // means the developer is setting or overriding it by hand — mark it
    // 'manual' so a later automated review-extraction run never clobbers it
    // (Phase 8, CLAUDE.md §15 non-blending rule).
    if ('drinking_window' in req.body) updates.drinking_window_source = 'manual'
    if ('vintage_rating' in req.body) updates.vintage_rating_source = 'manual'
    const wine = await getStorage().updateWine(req.params.id, updates)
    res.json(wine)
  })
)

// POST /api/wines/:id/fetch-price — trigger retailer crawl and store price + critic score data
router.post(
  '/:id/fetch-price',
  wrap(async (req, res) => {
    const wine = await getStorage().getWine(req.params.id)
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' })
      return
    }

    const result = await fetchPriceData(wine)
    if (!result) {
      res.status(503).json({ error: 'Price data unavailable — OPENAI_API_KEY or SERPER_API_KEY not configured, or no retailer results found' })
      return
    }

    const updates: UpdateWineInput = {
      price_data: {
        price_min: result.price_min,
        price_avg: result.price_avg,
        price_max: result.price_max,
        retailers: result.retailers,
        nearest_retailer: result.nearest_retailer,
        fetched_at: result.fetched_at,
      },
    }

    const updated = await getStorage().updateWine(req.params.id, updates)
    res.json(updated)
  })
)

// POST /api/wines/:id/fetch-reviews — trigger review/critic-score sourcing (Phase 7)
// Unlike /fetch-price, this always succeeds: an empty review_data array
// covers "not configured" and "nothing found" alike (modules/reviews/
// degrades gracefully rather than distinguishing them — see CLAUDE.md §5).
router.post(
  '/:id/fetch-reviews',
  wrap(async (req, res) => {
    const wine = await getStorage().getWine(req.params.id)
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' })
      return
    }

    const review_data = await fetchReviewData(wine)
    const derived = deriveWineLevelFields(review_data, {
      drinking_window_source: wine.drinking_window_source,
      vintage_rating_source: wine.vintage_rating_source,
    })
    const updated = await getStorage().updateWine(req.params.id, { review_data, ...derived })
    res.json(updated)
  })
)

// POST /api/wines/:id/confirm-retailer-link — guided manual confirmation (Phase 7.2)
// Given a retailer slug and a URL the user found and copied themselves
// (not discovered automatically), renders it and runs the same windowed
// GPT-4o extraction pipeline as automated review sourcing — now also
// pulling the page's stated vintage — and writes the result into both
// price_data.retailers[] and review_data, since the existing UI reads
// price from one and critic scores from the other. The confirmed URL is
// always saved to retailer_links[slug], even if rendering or extraction
// fails below, so the user's find is never lost.
router.post(
  '/:id/confirm-retailer-link',
  wrap(async (req, res) => {
    const { slug, url } = req.body as { slug?: string; url?: string }
    if (!slug || !url) {
      res.status(400).json({ error: 'slug and url are required' })
      return
    }

    const wine = await getStorage().getWine(req.params.id)
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' })
      return
    }

    const retailer = RETAILER_CONFIG.find((r) => r.slug === slug)
    if (!retailer) {
      res.status(400).json({ error: `Unknown retailer slug: ${slug}` })
      return
    }

    const retailer_links = { ...(wine.retailer_links ?? {}), [slug]: url }

    const openaiKey = process.env.OPENAI_API_KEY
    const html = openaiKey ? await renderPageHtml(url) : null
    const extraction = html && openaiKey
      ? await extractFromRenderedHtml(new OpenAI({ apiKey: openaiKey }), extractCandidateText(html), url)
      : null

    // Render or extraction failed (no key, timeout, parse error) — still
    // save the confirmed link so the user doesn't lose their find; nothing
    // to update in price_data/review_data without a successful extraction.
    if (!extraction) {
      const updated = await getStorage().updateWine(req.params.id, { retailer_links })
      res.json(updated)
      return
    }

    const matched_vintage = extraction.vintage
    const vintage_mismatch =
      matched_vintage !== null && wine.vintage !== null && matched_vintage !== wine.vintage

    const retailerPrice: RetailerPrice = {
      slug: retailer.slug,
      name: retailer.name,
      price: extraction.price,
      url,
      distance_miles: Math.round(haversineDistanceMiles(NYC.lat, NYC.lng, retailer.lat, retailer.lng)),
      is_preferred_retailer: true,
      is_search_results_page: false,
      matched_vintage,
      vintage_mismatch,
      pack_quantity: 1,
      bottle_size_ml: null,
      non_standard_format: false,
      format_label: '',
      // A manually-confirmed page — even K&L's — is a real, user-verified
      // price, not the always-present unverified placeholder. Replaces that
      // placeholder in mergedRetailers below (filtered out by slug).
      link_only: false,
    }
    const mergedRetailers = [
      ...(wine.price_data?.retailers ?? []).filter((r) => r.slug !== slug),
      retailerPrice,
    ]
    const price_data = aggregatePriceData(mergedRetailers)

    const retailerReview: RetailerReview = {
      slug: retailer.slug,
      name: retailer.name,
      product_url: url,
      critic_scores: extraction.critic_scores,
      fetched_at: new Date().toISOString(),
      // Tied to a real RETAILER_CONFIG slug (checked above), just found
      // manually rather than by automated search — 'configured', not
      // 'fallback' (that's reserved for the open-web pass, Phase 7.3).
      source: 'configured',
    }
    const review_data = [
      ...(wine.review_data ?? []).filter((r) => r.slug !== slug),
      retailerReview,
    ]

    const derived = deriveWineLevelFields(review_data, {
      drinking_window_source: wine.drinking_window_source,
      vintage_rating_source: wine.vintage_rating_source,
    })

    const updated = await getStorage().updateWine(req.params.id, { retailer_links, price_data, review_data, ...derived })
    res.json(updated)
  })
)

// GET /api/wines/:id/retailer-links — generated retailer search links (Phase 6.6)
// Computed fresh from wine identity fields on every call — never stored.
// Distinct from the `retailer_links` field on the wine entry itself, which
// holds only URLs the user has explicitly saved (via PATCH /:id).
router.get(
  '/:id/retailer-links',
  wrap(async (req, res) => {
    const wine = await getStorage().getWine(req.params.id)
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' })
      return
    }

    res.json(getRetailerLinks(wine))
  })
)

export default router
