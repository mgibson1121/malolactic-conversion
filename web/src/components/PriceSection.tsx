import { useState } from 'react'
import type { RetailerPrice, WineEntry } from '@shared/types'
import type { EnrichmentAction } from '../hooks/useEnrichmentAction'
import { effectivePrice } from '@shared/utils/effective-price'
import { priceExclusionsOf, staleOf } from '../utils/wineDerived'
import { BADGE_EXPLANATIONS, badgeKindOf, type BadgeKind } from '../utils/verificationCopy'
import { EnrichmentRow } from './EnrichmentRow'
import { RetailerViewLink } from './RetailerViewLink'

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
      {r.non_standard_format && (
        <span className="format-badge" title="Price is for this format, not a single standard 750ml bottle">
          {r.format_label}
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
        kind="price"
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

  const nearest = data.nearest_retailer
  const others = data.retailers.filter((r) => !(nearest && r.slug === nearest.slug))

  const body = (
    <div className="price-section">
      {manual && <div className="price-section-header"><span className="price-source-label">Retailer prices (automated)</span></div>}

      {stale && <p className="stale-notice">Fetched for a different version of this wine — may not match. Refresh.</p>}

      {data.retailers.length === 0 ? (
        <>
          <p className="price-not-found">No matching listings found at the configured retailers.</p>
          <div className="price-fetched-at">Checked {new Date(data.fetched_at).toLocaleDateString()}</div>
        </>
      ) : (
        <>
          {data.price_avg != null ? (
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
            </div>
          ) : (
            exclusions && <p className="price-no-average">{exclusions.sentence}</p>
          )}

          {data.other_vintage_price_range && (
            <p className="price-other-vintages">
              Other vintages: {fmt(data.other_vintage_price_range.min)}–{fmt(data.other_vintage_price_range.max)}
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
              {nearest.price != null && <span className="nearest-price">{fmt(nearest.price)}</span>}
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
                      <span className="retailer-price">{r.link_only ? '' : fmt(r.price)}</span>
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
