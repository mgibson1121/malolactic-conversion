import type { PriceData, WineEntry } from '@shared/types'
import { RetailerViewLink } from './RetailerViewLink'

interface Props {
  priceData: PriceData
  wineId: string
  onWineUpdated: (wine: WineEntry) => void
}

const fmt = (n: number | null | undefined) =>
  n != null ? `$${n.toFixed(0)}` : '—'

// Phase 11 — RetailerPrice.verification was computed backend-side (Phase 6's
// verify-listing.ts) but never surfaced anywhere in the UI. 'unchecked'
// renders nothing — the pill's absence IS that state, same convention the
// app already uses for other never-attempted signals.
function VerificationPill({ verification }: { verification: PriceData['retailers'][number]['verification'] }) {
  if (verification === 'verified') {
    return <span className="pill pill-green verification-pill" title="Live-confirmed at the retailer's page">Verified</span>
  }
  if (verification === 'unverified') {
    return <span className="pill pill-red verification-pill" title="Could not confirm this listing is still live">Unverified</span>
  }
  return null
}

export function PriceSection({ priceData, wineId, onWineUpdated }: Props) {
  // Fetched successfully but no relevant listing was found — do not fall
  // through to the price range/retailer list below, which would otherwise
  // render as all dashes with no explanation of why.
  if (priceData.retailers.length === 0) {
    return (
      <div className="price-section">
        <div className="price-section-header">
          <span className="price-source-label">Retailer Crawl</span>
        </div>
        <p className="price-not-found">
          No matching listings found for this wine at the configured retailers.
        </p>
        <div className="price-fetched-at">
          Checked {new Date(priceData.fetched_at).toLocaleDateString()}
        </div>
      </div>
    )
  }

  return (
    <div className="price-section">
      <div className="price-section-header">
        <span className="price-source-label">Retailer Crawl</span>
        <span className="price-source-note">{priceData.retailers.length} retailer{priceData.retailers.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="price-range">
        <span className="price-stat">
          <span className="price-label">Min</span>
          <span className="price-value">{fmt(priceData.price_min)}</span>
        </span>
        <span className="price-divider">·</span>
        <span className="price-stat">
          <span className="price-label">Avg</span>
          <span className="price-value">{fmt(priceData.price_avg)}</span>
        </span>
        <span className="price-divider">·</span>
        <span className="price-stat">
          <span className="price-label">Max</span>
          <span className="price-value">{fmt(priceData.price_max)}</span>
        </span>
      </div>

      {priceData.nearest_retailer && (
        <div className="nearest-retailer">
          <span className="nearest-label">Nearest</span>
          <span className="nearest-name">{priceData.nearest_retailer.name}</span>
          {priceData.nearest_retailer.price != null && (
            <span className="nearest-price">{fmt(priceData.nearest_retailer.price)}</span>
          )}
          {priceData.nearest_retailer.matched_vintage != null && (
            <span
              className={priceData.nearest_retailer.vintage_mismatch ? 'vintage-mismatch-badge' : 'vintage-match-badge'}
              title={
                priceData.nearest_retailer.vintage_mismatch
                  ? 'Price shown is for a different vintage than this wine entry'
                  : 'Vintage confirmed from the matched listing'
              }
            >
              {priceData.nearest_retailer.matched_vintage} vintage
            </span>
          )}
          {priceData.nearest_retailer.non_standard_format && (
            <span
              className="format-badge"
              title="Price is for this format, not a single standard 750ml bottle"
            >
              {priceData.nearest_retailer.format_label}
            </span>
          )}
          <span className="nearest-distance">{priceData.nearest_retailer.distance_miles} mi</span>
          <VerificationPill verification={priceData.nearest_retailer.verification} />
          <RetailerViewLink
            wineId={wineId}
            retailer={priceData.nearest_retailer}
            onWineUpdated={onWineUpdated}
            className="retailer-link"
          />
        </div>
      )}

      {priceData.retailers.length > 0 && (
        <div className="retailer-list">
          {priceData.retailers.map((r, i) => (
            <div key={i} className="retailer-row">
              <span className="retailer-name">{r.name}</span>
              <span className="retailer-price">{r.link_only ? '' : fmt(r.price)}</span>
              {r.link_only && (
                <span
                  className="link-only-badge"
                  title="This retailer blocks automated price verification — link only, not included in price stats"
                >
                  Search only
                </span>
              )}
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
                <span
                  className="format-badge"
                  title="Price is for this format, not a single standard 750ml bottle"
                >
                  {r.format_label}
                </span>
              )}
              <VerificationPill verification={r.verification} />
              <RetailerViewLink
                wineId={wineId}
                retailer={r}
                onWineUpdated={onWineUpdated}
                className="retailer-link"
              />
            </div>
          ))}
        </div>
      )}

      <div className="price-fetched-at">
        Updated {new Date(priceData.fetched_at).toLocaleDateString()}
      </div>
    </div>
  )
}
