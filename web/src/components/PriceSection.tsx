import { useState } from 'react'
import type { RetailerPrice, WineEntry } from '@shared/types'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { effectivePrice } from '@shared/utils/effective-price'
import { priceExclusionsOf, priceWindowOfWine, staleOf } from '../utils/wineDerived'
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
      <p className="price-no-average">
        These prices are too far apart for one average — this may be more than one bottling.
      </p>
      <p className="tier-marker">
        Prices: split by the 2.5× rule{' '}
        <button type="button" className="link info-badge" aria-label="What is the 2.5× rule?" onClick={() => setExplain(true)}>
          ⓘ
        </button>
      </p>
      {explain && (
        <Sheet title="Why there is no single average" onClose={() => setExplain(false)}>
          <p>
            When the highest price we counted is 2.5 times the lowest or more, one average would be a number nobody is
            actually offered. Usually that means the listings are not all the same bottling — a plain wine and a named
            vineyard, say.
          </p>
          <p>Nothing was dropped. Both groups are shown, and every listing is still listed below. If you tell us which bottling is yours, we recompute from the listings that name it.</p>
        </Sheet>
      )}
      <ul className="price-group-list">
        {groups.map((g, i) => (
          <li key={i} className="price-group">
            <span className="price-value">{range(g)}</span>
            <span className="price-group-count">
              {g.retailers.length} {g.retailers.length === 1 ? 'listing' : 'listings'}
            </span>
          </li>
        ))}
      </ul>
    </div>
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

function RetailerBadges({ r }: { r: RetailerPrice }) {
  const kind = badgeKindOf(r)
  return (
    <>
      {r.matched_vintage != null && (
        <span
          className={r.vintage_mismatch ? 'vintage-mismatch-badge' : 'vintage-match-badge'}
          title={
            r.vintage_mismatch
              ? 'Price shown is for a different vintage than this wine entry'
              : 'Vintage confirmed from the matched listing'
          }
        >
          {r.matched_vintage} vintage
        </span>
      )}
      {r.normalized ? (
        <span
          className="format-badge format-badge--counted"
          title={`Counted at ${fmt(r.price_per_750)} per 750 ml bottle: the ${fmt(r.normalized.shelf_price)} shelf price divided by ${r.normalized.divisor}`}
        >
          {`÷${r.normalized.divisor} ${r.normalized.kind}`}
        </span>
      ) : (
        r.non_standard_format && (
          <span className="format-badge" title="Price is for this format, not a single standard 750ml bottle">
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
          price suggests a larger format — size unconfirmed
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
          <span className="critic-reviews-looking-text">Looking up prices…</span>
        </div>
      )}

      {failed && (
        <p className="price-failed">
          Price lookup failed —{' '}
          <button type="button" className="btn-link-inline" onClick={() => action.run()}>
            Try again
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
  const exclusions = priceExclusionsOf(wine)

  // Only listings within ±3 vintages are shown (Phase 12.4 WI-1); the rest stay stored.
  const window = priceWindowOfWine(wine)
  const visible = data.retailers.filter((r) => !window?.hidden.includes(r.slug))
  const otherVintages = window ? window.other_vintage_price_range : data.other_vintage_price_range
  const nearest = data.nearest_retailer
  const others = visible.filter((r) => !(nearest && r.slug === nearest.slug))

  const body = (
    <div className="price-section">
      {manual && <div className="price-section-header"><span className="price-source-label">Retailer prices (automated)</span></div>}

      {stale && <p className="stale-notice">Fetched for a different version of this wine — may not match. Refresh.</p>}

      {visible.length === 0 ? (
        <>
          <p className="price-not-found">No matching listings found at the configured retailers.</p>
          <div className="price-fetched-at">Checked {new Date(data.fetched_at).toLocaleDateString()}</div>
        </>
      ) : (
        <>
          {data.headline_basis === 'ambiguous' && data.price_groups ? (
            <PriceGroups data={data} />
          ) : data.price_avg != null ? (
            <div className="price-range">
              <span className="price-stat">
                <span className="price-label">Avg</span>
                <span className="price-value">{fmt(data.price_avg)}</span>
              </span>
              <span className="price-divider">·</span>
              <span className="price-stat">
                <span className="price-label">High</span>
                <span className="price-value">{fmt(data.price_max)}</span>
              </span>
              <span className="price-divider">·</span>
              <span className="price-stat">
                <span className="price-label">Low</span>
                <span className="price-value">{fmt(data.price_min)}</span>
              </span>
              {data.headline_estimated && (
                <span className="price-estimated" title="A pack, case or magnum price divided down to a single 750 ml bottle">
                  estimated
                </span>
              )}
            </div>
          ) : (
            exclusions && <p className="price-no-average">{exclusions.sentence}</p>
          )}

          {data.headline_basis === 'single_listing' && data.price_avg != null && (
            <p className="price-single-listing">
              {data.headline_estimated
                ? 'Based on a single listing, counted at a per-bottle price.'
                : 'Based on a single listing — size not confirmed.'}
            </p>
          )}

          {otherVintages && (
            <p className="price-other-vintages">
              Other vintages: {fmt(otherVintages.min)}–{fmt(otherVintages.max)}
            </p>
          )}

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
              {nearest.price != null && <RowPrice r={nearest} />}
              <RetailerBadges r={nearest} />
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
                      <RetailerBadges r={r} />
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

          <div className="price-fetched-at">Updated {new Date(data.fetched_at).toLocaleDateString()}</div>
        </>
      )}
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
