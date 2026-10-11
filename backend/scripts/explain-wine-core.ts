import type { WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { buildDistinguishingQuery, identityOf, scoreMatch, isAcceptableMatch } from '@shared/utils/wine-match'
import { isNonProductUrl } from '@shared/config/denylisted-domains'
import { buildQueryVariants } from '../modules/reviews/find-product-page'
import { aggregatePriceData, countedPrice, exclusionReason } from '../modules/price/aggregate'
import type { RetailerResult } from '../modules/price/types'

/**
 * Per-stage explanation of one stored wine (Phase 12.2 WI-0), replayed from
 * what is already in the database: **no network, no metered call**. Every
 * silent miss in the 2026-10-04 device test took live debugging to explain;
 * this makes the next one a read.
 *
 * Stages: identity -> price query -> each price listing and why it is or is
 * not counted -> the headline those produce (recomputed, to show it matches
 * what is stored) -> review queries per retailer -> each stored review page and
 * the matcher's verdict per dimension -> the probe memory.
 *
 * Pure (WineEntry in, lines out) so it can be tested against fixtures.
 */
export function explainWine(wine: WineEntry): string[] {
  const out: string[] = []
  const line = (s = '') => out.push(s)
  const identity = identityOf(wine)

  line(`# ${wine.producer} — ${wine.denomination}${wine.vintage ? ` ${wine.vintage}` : ' NV'}   (${wine.id})`)
  line(`identity: producer="${identity.producer}" denomination="${identity.denomination}" vintage=${identity.vintage ?? 'NV'} cuvee=${identity.cuvee ?? '-'} vineyard=${identity.vineyard ?? '-'} classification=${identity.quality_classification ?? '-'}`)
  line()

  // ── Price ──────────────────────────────────────────────────────────────
  line('## Price')
  line(`stage 1 — Serper Shopping query: ${buildDistinguishingQuery(wine, { includeVintage: true }) || '(empty)'}`)
  const price = wine.price_data
  if (!price) {
    line('stage 2 — never fetched (price_data is null).')
  } else {
    line(`fetched ${price.fetched_at}; stored headline: min=${price.price_min ?? '-'} avg=${price.price_avg ?? '-'} max=${price.price_max ?? '-'} basis=${price.headline_basis ?? '(not recorded)'}`)
    if (price.retailers.length === 0) line('stage 2 — searched and found nothing (no listings survived matching and the live-page check).')
    for (const r of price.retailers as unknown as RetailerResult[]) {
      const why = exclusionReason(r)
      const counted = countedPrice(r)
      const format = r.normalized
        ? `÷${r.normalized.divisor} ${r.normalized.kind} (${r.normalized.source}) -> ${r.price_per_750}`
        : r.non_standard_format
          ? `format ${r.format_label || `${r.pack_quantity}x ${r.bottle_size_ml ?? 750}ml`}`
          : 'standard bottle'
      line(
        `  ${r.name.padEnd(22)} price=${String(r.price ?? '-').padEnd(8)} vintage=${r.matched_vintage ?? '?'}(${r.vintage_verdict}) ${format} verification=${r.verification}` +
          `\n      -> ${why ? `NOT COUNTED: ${why}` : `counted at ${counted}`}${r.other_storefront ? ' [other storefront]' : ''}`
      )
    }
    const recomputed = aggregatePriceData(price.retailers as unknown as RetailerResult[])
    line(`recomputed from the stored listings: min=${recomputed.price_min ?? '-'} avg=${recomputed.price_avg ?? '-'} max=${recomputed.price_max ?? '-'} basis=${recomputed.headline_basis}${recomputed.headline_estimated ? ' (estimated)' : ''}`)
    if (recomputed.price_groups) line(`  groups: ${recomputed.price_groups.map(g => `$${g.min}–$${g.max} [${g.retailers.join(', ')}]`).join('  |  ')}`)
    line(`  excluded: ${JSON.stringify(recomputed.excluded)}`)
    if (price.price_avg !== recomputed.price_avg || (price.headline_basis && price.headline_basis !== recomputed.headline_basis)) {
      line('  note: the stored headline differs from the recomputation — the blob predates a rule change; a refresh would update it.')
    }
  }
  line()

  // ── Reviews ────────────────────────────────────────────────────────────
  line('## Reviews')
  line('stage 1 — queries a live run would send (primary tier shown first; nothing is sent here):')
  for (const retailer of RETAILER_CONFIG) {
    line(`  [${retailer.reviewTier}] ${retailer.name}: ${buildQueryVariants(identity, retailer.domain).join('  ||  ')}`)
  }
  const reviews = wine.review_data
  if (!reviews) {
    line('stage 2 — never fetched (review_data is null).')
  } else if (reviews.length === 0) {
    line('stage 2 — searched and found nothing acceptable (review_data is []).')
  } else {
    line(`stage 2 — ${reviews.length} stored page(s); matcher verdict replayed from each URL:`)
    for (const r of reviews) {
      const verdict = scoreMatch({ title: slugTitle(r.product_url), url: r.product_url }, identity)
      line(`  ${r.name} (${r.source}) ${r.product_url}`)
      line(`      page vintage=${r.page_vintage ?? '?'} gap=${r.vintage_gap ?? '?'} scores=${r.critic_scores.length}${r.critic_scores.length ? ` [${r.critic_scores.map(s => `${s.publication} ${s.score}`).join(', ')}]` : ''}`)
      line(`      replay: producer=${verdict.producer} denomination=${verdict.denomination} bottling=${verdict.bottling} vintage=${verdict.vintage} -> ${isAcceptableMatch(verdict) ? 'acceptable' : 'REJECTED'}${isNonProductUrl(r.product_url) ? ' (url shape is non-product)' : ''}`)
      if (r.critic_scores.length === 0) line('      this page was accepted but extraction returned no score — see stage 3 (extraction) below.')
    }
    line('stage 3 — extraction cannot be replayed without the rendered page (not stored, copyright boundary). Re-render with scripts/ground-truth-check.ts.')
  }
  const probes = wine.review_probe_log
  line(`probe memory: ${probes && probes.length ? probes.map(p => `${p.slug}=${p.stage}@${p.probed_at.slice(0, 10)}`).join(', ') : '(none)'}`)
  return out
}

/** A product slug as title-ish text: the matcher reads the producer and vintage out of it. */
function slugTitle(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '').replace(/[-_]+/g, ' ')
  } catch {
    return url
  }
}

/** Credits a --live run of the review queries would cost, printed before anything is sent (CLAUDE.md §15). */
export function liveCostEstimate(wine: WineEntry): { retailers: number; maxCredits: number } {
  const identity = identityOf(wine)
  const primary = RETAILER_CONFIG.filter(r => r.reviewTier === 'primary')
  const maxCredits = primary.reduce((n, r) => n + buildQueryVariants(identity, r.domain).length, 0)
  return { retailers: primary.length, maxCredits }
}
