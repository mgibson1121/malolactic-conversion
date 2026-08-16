import OpenAI from 'openai'
import { Router, Request, Response, NextFunction } from 'express'
import { getStorage } from '../modules/storage'
import { CreateWineSchema, UpdateWineSchema } from '@shared/validation'
import type {
  RetailerPrice,
  RetailerReview,
  ReviewProbeLogEntry,
  UpdateWineInput,
  WineEntry,
  WineFilter,
} from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { haversineDistanceMiles } from '@shared/utils/proximity'
import { scoreMatch, type MatchVerdict } from '@shared/utils/wine-match'
import { NYC } from '@shared/config/retailers.config'
import { fetchPriceData, aggregatePriceData } from '../modules/price'
import { getRetailerLinks } from '../modules/retailer-links'
import { fetchReviewData } from '../modules/reviews'
import { mergeProbeLog } from '../modules/reviews/probe-log'
import { findMerchantProductPage, findProductPageDetailed } from '../modules/reviews/find-product-page'
import { renderPageHtml } from '../modules/reviews/puppeteer-extract'
import { extractCandidateText } from '../modules/reviews/keyword-window'
import { extractFromRenderedHtml } from '../modules/reviews/gpt-extract'
import { deriveWineLevelFields } from '../modules/reviews/derive-wine-level'
import { accountSerperUsage } from '@shared/utils/serper-client'
import {
  coalesce,
  isWithinTtl,
  newestTimestamp,
  PRICE_TTL_DAYS,
  REVIEWS_TTL_DAYS,
} from './enrichment-cache'

const router = Router()

/**
 * Turns one retailer's search-results URL into its real product page
 * (2026-08-05, reworked Phase 9.2 WI-6, widened 2026-08-15).
 *
 * Two kinds of search-results URL reach this function, and each gets the
 * search that actually fits it:
 *
 * - A **fallback** merchant (not in RETAILER_CONFIG) has no known domain —
 *   `price/` only has a name, from Serper Shopping's `source` field, and a
 *   `google.com/search?ibp=oshop` aggregator link, never a product URL
 *   (confirmed against the live response: the only fields are title, source,
 *   link, price, imageUrl, productId, position, rating, ratingCount). The
 *   open, name-based findMerchantProductPage (added for the Phase 9.1
 *   cross-feed) is the only thing that can search for it.
 * - A **configured** retailer (RETAILER_CONFIG has its domain) gets a
 *   `site:`-restricted search instead — findProductPageDetailed, the same
 *   Step 1 modules/reviews/ runs. This is why K&L's price-section link used
 *   to be permanently a generic on-site search box even though modules/
 *   reviews/ can find its real product pages just fine: K&L's bot-block is
 *   at *render* (Puppeteer), not *search* (Serper), and this function only
 *   ever searches — it never renders. Widening the gate below from
 *   "URL looks like google.com/search" to `is_search_results_page` (already
 *   computed correctly server-side for every retailer, preferred or not) is
 *   what actually lets that shorter, more reliable search run for K&L and
 *   every other configured retailer whose price entry is still a search box
 *   (Benchmark, Acker, etc.) — previously the string check only ever matched
 *   fallback merchants, so configured retailers never got a resolve attempt
 *   at all, regardless of intent.
 *
 * Either way this runs once, for one shop, at the moment the user actually
 * clicks "View" — see POST /:id/resolve-retailer-url below — never eagerly
 * on every fetch-price call (that discipline predates this widening; WI-6
 * killed the old up-to-5-calls-per-fetch version). A shop whose page can't
 * be found keeps its search link, which at least loads; a shop already
 * resolved is not re-queried, since a real product URL does not go stale
 * into a search page.
 */
export async function resolveOneRetailerUrl(
  wine: { producer: string | null; denomination: string | null; vintage: number | null; cuvee: string | null; vineyard: string | null },
  retailer: RetailerPrice
): Promise<RetailerPrice> {
  if (!retailer.is_search_results_page) return retailer

  const serperKey = process.env.SERPER_API_KEY
  if (!serperKey) return retailer

  const identity = {
    producer: wine.producer ?? '',
    denomination: wine.denomination ?? '',
    vintage: wine.vintage,
    cuvee: wine.cuvee,
    vineyard: wine.vineyard,
  }

  const configured = RETAILER_CONFIG.find(r => r.slug === retailer.slug)
  const outcome = configured
    ? await findProductPageDetailed(identity, configured, serperKey, `price:resolve-url:${retailer.slug}`)
    : await findMerchantProductPage(identity, retailer.name, serperKey, {
        label: `price:resolve-url:${retailer.slug}`,
      })
  if (!outcome.url) return retailer
  return { ...retailer, url: outcome.url, is_search_results_page: false }
}

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

/**
 * What one coalesced enrichment run produced (Phase 9.2, WI-4).
 *
 * A union rather than a thrown error because the failure is shared: two
 * requests that coalesced onto one run both receive this, and both must be
 * able to send the same status the single run would have sent.
 */
type EnrichmentOutcome =
  | { ok: true; wine: WineEntry }
  | { ok: false; status: number; error: string }

/** `?force=true` bypasses the freshness guard (Phase 9.2, WI-4). Anything else
 * — absent, empty, 'false' — leaves it in place, so a mistyped query string
 * costs nothing. */
function isForced(req: Request): boolean {
  return req.query.force === 'true'
}

/** The response body for a run the freshness guard declined to make. The wine
 * is returned unchanged, so a caller that only wanted to see its data gets it
 * without a special case. */
function cachedResponse(wine: WineEntry, fetched_at: string) {
  return { ...wine, cached: true, fetched_at }
}

// POST /api/wines/:id/fetch-price — trigger retailer crawl and store price + critic score data
// Without ?force=true, stored price data newer than PRICE_TTL_DAYS is returned
// as-is and no outbound call is made (Phase 9.2, WI-4).
router.post(
  '/:id/fetch-price',
  wrap(async (req, res) => {
    const wine = await getStorage().getWine(req.params.id)
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' })
      return
    }

    const storedAt = wine.price_data?.fetched_at ?? null
    if (!isForced(req) && isWithinTtl(storedAt, PRICE_TTL_DAYS)) {
      res.json(cachedResponse(wine, storedAt!))
      return
    }

    // Coalesced, so a double-click joins the run already under way rather than
    // starting a second full-price one — see enrichment-cache.ts. The write is
    // inside the coalesced region too: two runs racing to persist the same
    // wine is the other half of what a double-click costs.
    const outcome = await coalesce<EnrichmentOutcome>(`${req.params.id}:fetch-price`, () =>
      // Every outbound Serper call below is attributed to this wine and this
      // action (Phase 9.2) — see shared/utils/serper-client.ts.
      accountSerperUsage({ wine_id: req.params.id, action: 'fetch-price' }, async () => {
        // Cross-feed (Phase 9.1): a product page modules/reviews/ already
        // rendered and matched is the strongest possible evidence a shop
        // carries this wine, and price/ was throwing it away — reviews found a
        // live Woodland Hills product page for Mangot 2022 with 7 critic
        // scores in the same run price/ returned zero retailers for it. The
        // two modules must not import each other (CLAUDE.md §5), so the router
        // is where they meet.
        const result = await fetchPriceData(wine, {
          confirmedProductPages: (wine.review_data ?? []).map((r) => ({
            slug: r.slug,
            name: r.name,
            product_url: r.product_url,
            // The shop's own price, off the shop's own page — see
            // ConfirmedProductPage. Null when the extraction read none.
            price: r.page_price ?? null,
          })),
        })
        if (!result) {
          return {
            ok: false,
            status: 503,
            error: 'Price data unavailable — OPENAI_API_KEY or SERPER_API_KEY not configured, or no retailer results found',
          }
        }

        // Fallback retailers keep their constructed Google search URL here —
        // resolving it to a real product page is deferred to the moment the
        // user clicks "View" (Phase 9.2, WI-6; see POST
        // /:id/resolve-retailer-url below), not spent unconditionally on
        // links most users never open.
        const priceData = aggregatePriceData(result.retailers)

        const updates: UpdateWineInput = {
          price_data: {
            price_min: priceData.price_min,
            price_avg: priceData.price_avg,
            price_max: priceData.price_max,
            other_vintage_price_range: priceData.other_vintage_price_range,
            retailers: priceData.retailers,
            nearest_retailer: priceData.nearest_retailer,
            fetched_at: priceData.fetched_at,
          },
        }
        return { ok: true, wine: await getStorage().updateWine(req.params.id, updates) }
      })
    )

    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error })
      return
    }
    res.json(outcome.wine)
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

    // review_data timestamps each retailer separately, so the wine's own
    // freshness is the newest of them. A wine that has never been fetched has
    // no timestamp at all and always runs.
    const storedAt = newestTimestamp((wine.review_data ?? []).map((r) => r.fetched_at))
    if (!isForced(req) && isWithinTtl(storedAt, REVIEWS_TTL_DAYS)) {
      res.json(cachedResponse(wine, storedAt!))
      return
    }

    // force=true clears this wine's probe log as well as bypassing the TTL
    // (Phase 9.2, WI-4/WI-5): a deliberate re-check should not be silently
    // skipped by a stale negative from before whatever prompted the click.
    const existingProbeLog = isForced(req) ? [] : wine.review_probe_log ?? []

    const outcome = await coalesce<EnrichmentOutcome>(`${req.params.id}:fetch-reviews`, () =>
      accountSerperUsage({ wine_id: req.params.id, action: 'fetch-reviews' }, async () => {
        const probeLogSink: ReviewProbeLogEntry[] = []
        // The other half of the cross-feed: retailers price/ discovered that
        // RETAILER_CONFIG doesn't cover. price/ found central-wine-merchants
        // for Montus; reviews/ only ever iterated RETAILER_CONFIG, so it never
        // looked. Consumed only when no configured retailer yields a score.
        const review_data = await fetchReviewData(wine, {
          discoveredRetailers: (wine.price_data?.retailers ?? []).map((r) => ({
            slug: r.slug,
            name: r.name,
          })),
          existingProbeLog,
          probeLogSink,
        })
        // Null means the search could not be run (no key, or every Serper
        // request failed) — as distinct from running and finding nothing.
        // Write nothing rather than erasing whatever this wine already had; a
        // transient failure must never look like a result.
        if (review_data === null) {
          return {
            ok: false,
            status: 503,
            error:
              'Review sourcing unavailable — SERPER_API_KEY/OPENAI_API_KEY not configured, or the search requests failed. Existing review_data left untouched.',
          }
        }

        const derived = deriveWineLevelFields(review_data, {
          drinking_window_source: wine.drinking_window_source,
          vintage_rating_source: wine.vintage_rating_source,
        })
        const review_probe_log = mergeProbeLog(existingProbeLog, probeLogSink)
        return {
          ok: true,
          wine: await getStorage().updateWine(req.params.id, {
            review_data,
            review_probe_log,
            ...derived,
          }),
        }
      })
    )

    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error })
      return
    }
    res.json(outcome.wine)
  })
)

// POST /api/wines/:id/resolve-retailer-url — resolve one retailer's
// search-results link (a fallback merchant's constructed Google search, or a
// configured retailer's own on-site search box) into its real product page,
// at the moment the user clicks "View" (Phase 9.2, WI-6, widened 2026-08-15
// to cover configured retailers — see resolveOneRetailerUrl's docs for why
// that's safe even for K&L, whose render is bot-blocked but whose search
// isn't). Previously this ran unconditionally for every fallback retailer on
// every fetch-price call — up to 5 Serper calls per price fetch, for links
// most users never open. One credit, at the moment of intent, once per shop
// per wine forever: a retailer already resolved (is_search_results_page is
// already false) is returned unchanged with no outbound call.
router.post(
  '/:id/resolve-retailer-url',
  wrap(async (req, res) => {
    const { slug } = req.body as { slug?: string }
    if (!slug) {
      res.status(400).json({ error: 'slug is required' })
      return
    }

    const wine = await getStorage().getWine(req.params.id)
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' })
      return
    }

    const retailers = wine.price_data?.retailers ?? []
    const target = retailers.find((r) => r.slug === slug)
    if (!target) {
      res.status(404).json({ error: `No stored retailer with slug: ${slug}` })
      return
    }

    const resolved = await accountSerperUsage(
      { wine_id: req.params.id, action: 'resolve-retailer-url' },
      () => resolveOneRetailerUrl(wine, target)
    )
    // Nothing changed — already resolved, no key configured, or the search
    // came up empty (best-effort: the existing Google link still loads).
    if (resolved.url === target.url) {
      res.json(wine)
      return
    }

    const updatedRetailers = retailers.map((r) => (r.slug === slug ? resolved : r))
    // Re-aggregated so nearest_retailer references the updated entry rather
    // than its pre-resolution copy — the same class of stale-copy bug the
    // confirm-retailer-link handler already guards against.
    const priceData = aggregatePriceData(updatedRetailers)

    const updated = await getStorage().updateWine(req.params.id, {
      price_data: {
        price_min: priceData.price_min,
        price_avg: priceData.price_avg,
        price_max: priceData.price_max,
        other_vintage_price_range: priceData.other_vintage_price_range,
        retailers: priceData.retailers,
        nearest_retailer: priceData.nearest_retailer,
        // Deliberately not priceData.fetched_at (WI-4 vs WI-6 note): resolving
        // one link is not a re-check of every retailer's price, and stamping
        // "now" here would silently extend fetch-price's freshness TTL on the
        // strength of one shop's URL swap. price_min/avg/max/nearest_retailer
        // are recomputed correctly above from the same, unchanged price
        // figures — only fetched_at is held at its prior value.
        fetched_at: wine.price_data?.fetched_at ?? priceData.fetched_at,
      },
    })
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

    // Phase 9.1 — record the same MatchVerdict shape the automated path
    // stores, so the UI reads one field regardless of how a result was found.
    //
    // Producer and denomination are recorded as confirmed: the developer
    // found this exact product page themselves and copied its URL, which is
    // stronger evidence of identity than any text match. Running the matcher
    // over the URL instead would report a mismatch for every retailer whose
    // product slugs are opaque ids. Bottling and vintage are still judged —
    // bottling from the URL (a slug naming a different cuvée is worth
    // surfacing even on a confirmed page), vintage from GPT-4o's reading of
    // the rendered page.
    const urlVerdict = scoreMatch(
      { title: url, url, statedVintage: extraction.vintage },
      {
        producer: wine.producer ?? '',
        denomination: wine.denomination ?? '',
        vintage: wine.vintage ?? null,
        cuvee: wine.cuvee,
        vineyard: wine.vineyard,
        quality_classification: wine.quality_classification,
      }
    )
    const verdict: MatchVerdict = { ...urlVerdict, producer: 'match', denomination: 'match' }
    const matched_vintage = verdict.candidateVintage
    const vintage_mismatch = verdict.vintage === 'mismatch'

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
      vintage_verdict: verdict.vintage,
      pack_quantity: 1,
      bottle_size_ml: null,
      non_standard_format: false,
      format_label: '',
      // A manually-confirmed page — even K&L's — is a real, user-verified
      // price, not the always-present unverified placeholder. Replaces that
      // placeholder in mergedRetailers below (filtered out by slug).
      link_only: false,
      // The developer found and confirmed this exact product page by hand.
      // That is a stronger check than the automated live-search render, not
      // a weaker one — no Puppeteer pass is run or needed here.
      verification: 'verified',
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
      page_vintage: verdict.candidateVintage,
      vintage_gap: verdict.vintageGap,
      match: verdict,
      page_price: extraction.price,
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
