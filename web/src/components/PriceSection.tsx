import type { PriceData } from '@shared/types'

interface Props {
  priceData: PriceData
}

const fmt = (n: number | null) =>
  n != null ? `$${n.toFixed(0)}` : '—'

export function PriceSection({ priceData }: Props) {
  return (
    <div className="price-section">
      <div className="price-section-header">
        <span className="price-source-label">Wine-Searcher</span>
        {priceData.ws_score != null && (
          <span className="ws-score" title="Wine-Searcher aggregated critic score">
            {priceData.ws_score} pts
          </span>
        )}
      </div>

      <div className="price-range">
        <span className="price-stat">
          <span className="price-label">Min</span>
          <span className="price-value">{fmt(priceData.min_price)}</span>
        </span>
        <span className="price-divider">·</span>
        <span className="price-stat">
          <span className="price-label">Avg</span>
          <span className="price-value">{fmt(priceData.avg_price)}</span>
        </span>
        <span className="price-divider">·</span>
        <span className="price-stat">
          <span className="price-label">Max</span>
          <span className="price-value">{fmt(priceData.max_price)}</span>
        </span>
      </div>

      {priceData.retailers.length > 0 && (
        <div className="retailer-list">
          {priceData.retailers.slice(0, 5).map((r, i) => (
            <div key={i} className="retailer-row">
              <span className="retailer-name">{r.name}</span>
              {r.location && <span className="retailer-location">{r.location}</span>}
              <span className="retailer-price">{fmt(r.price)}</span>
              {r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="retailer-link"
                >
                  View
                </a>
              )}
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
