import { useState } from 'react'
import type { RetailerPrice, WineEntry } from '@shared/types'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { effectivePrice } from '@shared/utils/effective-price'
import { priceStateOfWine, staleOf } from '../utils/wineDerived'
import { BADGE_EXPLANATIONS, badgeKindOf, type BadgeKind } from '../utils/verificationCopy'
import { EnrichmentRow } from './EnrichmentRow'
import { RetailerViewLink } from './RetailerViewLink'
import { Sheet } from './Sheet'
import { bottlingBadge } from '@shared/utils/bottling-difference'

interface Props {
  wine: WineEntry
  action: EnrichmentAction
  onWineUpdated: (wine: WineEntry) => void
  /** 'card' folds the automated figures away when the developer's own price is
   * the headline; 'detail' and 'preview' show them. */
  variant?: 'card' | 'detail' | 'preview'
  /** The preview shows a Looking state before the first result; a card or
   * detail view that has never fetched shows a plain prompt. */
  lookupUnderWay?: boolean
}

const fmt = (n: number | null | undefined) => (n != null ? `$${n.toFixed(0)}` : '—')

/** The price a retailer row shows: the shelf price, and for a counted pack, case or magnum the per-bottle figure too. */
function RowPrice({ r }: { r: RetailerPrice }) {
  if (r.link_only) return null
  if (r.normalized && r.price_per_750 != null) {
    return (
      <span className="retailer-price">
        {fmt(r.normalized.shelf_price)} <span className="price-per-bottle">· {fmt(r.price_per_750)} a bottle</span>
      </span>
    )
  }
  return <span className="retailer-price">{fmt(r.price)}</span>
}

/** Two groups of prices that are too far apart for one average (Phase 12.2 D10). */
function PriceGroups({ data }: { data: NonNullable<WineEntry['price_data']> }) {
  const groups = data.price_groups ?? []
  const [explain, setExplain] = useState(false)
  const range = (g: { min: number; max: number }) => (g.min === g.max ? fmt(g.min) : `${fmt(g.min)}–${fmt(g.max)}`)
  return (
    <div className="price-groups" data-testid="price-groups">
      <p className="tier-marker">
        Split by the 2.5× rule{' '}
        <button type="button" className="link info-badge" aria-label="What is the 2.5× rule?" onClick={() => setExplain(true)}>
          ⓘ
        </button>
      </p>
      {explain && (
        <Sheet title="Why there is no single average" onClose={() => setExplain(false)}>
          <p>The highest price is 2.5 times the lowest or more, which usually means more than one bottling: {groups.length} groups, nothing dropped.</p>
        </Sheet>
      )}
      <ul className="price-group-list">
        {groups.map((g, i) => (
          <li key={i} className="price-group">
            <span className="price-value">{range(g)}</span>
            <span className="price-group-count">
              {g.retailers.length} {g.retailers.length === 1 ? 'shop' : 'shops'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** "Exact match" (Phase 12.5 WI-4): the exact wine and the exact vintage — nothing looser. */
export function ExactMatchBadge() {
  return (
    <span className="exact-match-badge" title="This exact wine and vintage">
      Exact match
    </span>
  )
}

/**
 * A badge on a retailer row that explains itself when tapped (Phase 12.1
 * WI-8): Verified / Unverified / Search only. Underlined, because it is
 * tappable (D9).
 */
function BadgePill({ kind }: { kind: BadgeKind }) {
  const [open, setOpen] = useState(false)
  const info = BADGE_EXPLANATIONS[kind]
  const tone = kind === 'verified' ? 'pill-green' : kind === 'unverified' ? 'pill-red' : 'pill-neutral'
  return (
    <span className="badge-with-info">
      <button
        type="button"
        className={`pill ${tone} verification-pill link info-badge`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {info.title}
      </button>
      {open && (
        <span className="badge-explanation" role="note">
          {info.text}
        </span>
      )}
    </span>
  )
}

function RetailerBadges({ r, exact = false }: { r: RetailerPrice; exact?: boolean }) {
  const kind = badgeKindOf(r)
  return (
    <>
      {exact && <ExactMatchBadge />}
      {r.matched_vintage != null && (
        <span
          className={r.vintage_mismatch ? 'vintage-mismatch-badge' : 'vintage-match-badge'}
          title={
            r.vintage_mismatch
              ? 'A different vintage'
              : 'Vintage confirmed from the matched listing'
          }
        >
          {r.matched_vintage} vintage
        </span>
      )}
      {r.normalized ? (
        <span
          className="format-badge format-badge--counted"
          title={`${fmt(r.price_per_750)} per 750 ml bottle: the ${fmt(r.normalized.shelf_price)} shelf price divided by ${r.normalized.divisor}`}
        >
          {`÷${r.normalized.divisor} ${r.normalized.kind}`}
        </span>
      ) : (
        r.non_standard_format && (
          <span className="format-badge" title="Not a 750 ml bottle">
            {r.format_label}
          </span>
        )
      )}
      {r.outside_bottling && r.bottling_difference?.colour ? (
        // Phase 12.4: a colour other than the wine's says which, not just "outside".
        <span className="format-badge" title="Left out of the average">
          {bottlingBadge(r.bottling_difference)}
        </span>
      ) : r.outside_bottling ? (
        <span className="format-badge" title={bottlingBadge({ extra: r.bottling_difference?.extra ?? [], missing: r.bottling_difference?.missing ?? [], colour: r.bottling_difference?.colour }) ?? ''}>
          outside your bottling
        </span>
      ) : (
        r.bottling_difference && (r.bottling_difference.extra.length > 0 || r.bottling_difference.missing.length > 0 || r.bottling_difference.colour) && (
          <span className="format-badge" title="Counted until you say which bottling is yours">
            {bottlingBadge(r.bottling_difference)}
          </span>
        )
      )}
      {r.suspected_large_format && (
        <span className="format-badge" title="Left out of the average">
          Size unconfirmed
        </span>
      )}
      {r.sold_out && (
        // Phase 12.4: the shop's own page says so — shown with its price, never counted.
        <span className="format-badge" title="Left out of the average">
          sold out
        </span>
      )}
      {kind && <BadgePill kind={kind} />}
    </>
  )
}

/**
 * "Price & retailers" (Phase 12.1 WI-7, D7): one section, grouped with its
 * retailers. The section title and its button both say so, because refreshing
 * price also refreshes the retailer links (it always did; the labels never
 * said).
 *
 * The developer's own price (D12) is the headline when set, marked "yours";
 * the automated avg/high/low stay below as "Retailer prices (automated)",
 * informational. When listings were found but none counted toward an average,
 * it says why, with counts, instead of showing a row of dashes (WI-4).
 *
 * Four states, never a vanishing block: looking, found, nothing found, failed.
 */
export function PriceBlock({ wine, action, onWineUpdated, variant = 'detail', lookupUnderWay = false }: Props) {
  const data = wine.price_data
  const manual = effectivePrice(wine).basis === 'manual'

  const looking = !data && (action.busy || (lookupUnderWay && !action.error))
  const failed = !data && !action.busy && !!action.error

  return (
    <div className="price-block">
      <h3 className="price-block-title">Price &amp; retailers</h3>

      {manual && (
        <div className="price-yours" data-testid="price-yours">
          <span className="detail-field-label">Your price (per 750 ml bottle)</span>
          <span className="price-yours-value">{fmt(wine.manual_price)}</span>
          <span className="yours-marker">yours</span>
        </div>
      )}

      {looking && (
        <div className="price-looking" role="status">
          <span className="skeleton-line" aria-hidden="true" />
          <span className="skeleton-line skeleton-line--short" aria-hidden="true" />
          <span className="critic-reviews-looking-text">Checking prices…</span>
        </div>
      )}

      {failed && (
        // Phase 12.5 WI-1: an error or timeout only (12.4 WI-7) — neutral, not alarming.
        <p className="price-failed">
          Couldn’t check prices.{' '}
          <button type="button" className="btn-link-inline" onClick={() => action.run()}>
            Retry
          </button>
        </p>
      )}

      {!data && !looking && !failed && <p className="detail-empty-hint">No price data yet.</p>}

      {data && (
        <AutomatedPrices wine={wine} onWineUpdated={onWineUpdated} folded={manual && variant === 'card'} manual={manual} />
      )}

      <EnrichmentRow
        action={action}
        label={data ? 'Refresh Price & retailers' : 'Fetch Price & retailers'}
        busyLabel={data ? 'Refreshing…' : 'Fetching…'}
        freshnessLabel="Price"
        hasData={!!data}
      />
    </div>
  )
}

function AutomatedPrices({
  wine,
  onWineUpdated,
  folded,
  manual,
}: {
  wine: WineEntry
  onWineUpdated: (wine: WineEntry) => void
  folded: boolean
  manual: boolean
}) {
  const data = wine.price_data!
  const [showMore, setShowMore] = useState(false)
  const stale = staleOf(wine).price
  // One state and one line, from the backend (Phase 12.5 WI-1).
  const state = priceStateOfWine(wine)
  // Priced rows only, within ±3 vintages, in the one display order (12.4 WI-1/WI-3).
  // Search-only links live under Trusted Retailers (WI-2).
  const rows = (state?.priced ?? []).map((slug) => data.retailers.find((r) => r.slug === slug)).filter((r): r is RetailerPrice => r !== undefined)
  const exact = new Set(state?.exact ?? [])
  const nearest = data.nearest_retailer && rows.some((r) => r.slug === data.nearest_retailer!.slug) ? rows.find((r) => r.slug === data.nearest_retailer!.slug)! : null
  const others = rows.filter((r) => !(nearest && r.slug === nearest.slug))
  const range = state?.range
  const showRange = range && (state?.kind === 'priced' || state?.kind === 'estimated') && range.min !== range.max

  const body = (
    <div className="price-section" data-state={state?.kind}>
      {manual && <div className="price-section-header"><span className="price-source-label">Retailer prices (automated)</span></div>}

      {stale && <p className="stale-notice">Found for an earlier version of this wine. Refresh.</p>}

      {state && (
        <p className={`price-state-line price-state-line--${state.kind}`} data-testid="price-state-line">
          {state.kind === 'priced' || state.kind === 'estimated' ? <strong className="price-value">{state.line}</strong> : state.line}
          {showRange && <span className="price-state-range"> · {fmt(range!.min)}–{fmt(range!.max)}</span>}
          {(state.kind === 'priced' || state.kind === 'estimated') && state.exact.length > 0 && (
            <>
              {' '}
              <ExactMatchBadge />
            </>
          )}
        </p>
      )}

      {state?.kind === 'wide_range' && data.price_groups && <PriceGroups data={data} />}

      {nearest && (
        <div className="nearest-retailer">
          <span className="nearest-label">Nearest</span>
          <RetailerViewLink
            wineId={wine.id}
            retailer={nearest}
            onWineUpdated={onWineUpdated}
            className="retailer-link link nearest-name"
            label={nearest.name}
          />
          <RowPrice r={nearest} />
          <RetailerBadges r={nearest} exact={exact.has(nearest.slug)} />
          <span className="nearest-distance">{nearest.distance_miles} mi</span>
        </div>
      )}

      {others.length > 0 && (
        <>
          <button
            type="button"
            className="btn-link-inline more-retailers-toggle"
            aria-expanded={showMore}
            onClick={() => setShowMore((o) => !o)}
          >
            {showMore ? 'Hide' : `${others.length} more ${others.length === 1 ? 'retailer' : 'retailers'}`}
          </button>
          {showMore && (
            <div className="retailer-list">
              {others.map((r) => (
                <div key={r.slug} className="retailer-row">
                  <span className="retailer-name">{r.name}</span>
                  <RowPrice r={r} />
                  <RetailerBadges r={r} exact={exact.has(r.slug)} />
                  <RetailerViewLink
                    wineId={wine.id}
                    retailer={r}
                    onWineUpdated={onWineUpdated}
                    className="retailer-link link"
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {rows.length > 0 && (
        <details className="badge-legend">
          <summary className="link">What do these badges mean?</summary>
          <ul>
            {(Object.keys(BADGE_EXPLANATIONS) as BadgeKind[]).map((k) => (
              <li key={k}>
                <strong>{BADGE_EXPLANATIONS[k].title}</strong> — {BADGE_EXPLANATIONS[k].text}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="price-fetched-at">Updated {new Date(data.fetched_at).toLocaleDateString()}</div>
    </div>
  )

  if (!folded) return body
  return (
    <details className="automated-prices-fold">
      <summary className="link">Retailer prices (automated)</summary>
      {body}
    </details>
  )
}
