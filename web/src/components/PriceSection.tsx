import type { PriceData } from '@shared/types'

interface Props {
  priceData: PriceData
}

const fmt = (n: number | null | undefined) =>
  n != null ? `$${n.toFixed(0)}` : '—'

export function PriceSection({ priceData }: Props) {
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

  const allScores = priceData.retailers.flatMap(r =>
    r.critic_scores.map(s => ({ ...s, retailer: r.name }))
  )
  // Deduplicate by publication — keep first occurrence
  const seenPublications = new Set<string>()
  const deduped = allScores.filter(s => {
    if (seenPublications.has(s.publication)) return false
    seenPublications.add(s.publication)
    return true
  })

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

      {deduped.length > 0 && (
        <div className="critic-scores">
          {deduped.map((s, i) => (
            <span key={i} className="critic-score-badge">
              <span className="critic-publication">{s.publication}</span>
              <span className="critic-score">{s.score}</span>
            </span>
          ))}
        </div>
      )}

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
          <a
            href={priceData.nearest_retailer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="retailer-link"
          >
            View
          </a>
        </div>
      )}

      {priceData.retailers.length > 0 && (
        <div className="retailer-list">
          {priceData.retailers.map((r, i) => (
            <div key={i} className="retailer-row">
              <span className="retailer-name">{r.name}</span>
              <span className="retailer-price">{fmt(r.price)}</span>
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
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="retailer-link"
              >
                View
              </a>
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
