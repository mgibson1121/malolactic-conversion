/**
 * DiscoveryReview.tsx
 * Post-scan / post-add decision screen (Phase 9.3). Replaces the old
 * price-only EnrichingCard, and — unlike that screen — is reached from
 * both creation paths (Scan Label and + Add Wine), not just scanning.
 *
 * Section order matches the developer's stated priority: reviews first (the
 * signal that answers "is this worth keeping"), then whether a preferred
 * retailer carries it, then price, then the wishlist/cellar decision.
 * Built entirely on Phase 9.2's existing enrichment plumbing — no new fetch
 * path, no parallel cache.
 */

import { useEffect, useState } from 'react'
import type { UpdateWineInput, WineEntry } from '@shared/types'
import { fetchWinePrice, fetchWineReviews } from '../api'
import { useEnrichmentAction } from '../hooks/useEnrichmentAction'
import { EnrichmentFreshness } from './EnrichmentFreshness'
import { PriceSection } from './PriceSection'
import { CriticScoreBadges } from './CriticScoreBadges'
import { getDedupedCriticScores } from '../utils/criticScores'
import { summarizePreferredRetailers } from '../utils/preferredRetailers'

interface Props {
  wine: WineEntry
  onDone: () => void
  onTagUpdate: (id: string, tags: UpdateWineInput) => void
  onWineUpdated: (wine: WineEntry) => void
}

export function DiscoveryReview({ wine: initialWine, onDone, onTagUpdate, onWineUpdated }: Props) {
  const [wine, setWine] = useState(initialWine)

  function applyUpdate(updated: WineEntry) {
    setWine(updated)
    onWineUpdated(updated)
  }

  const price = useEnrichmentAction(wine.id, fetchWinePrice, applyUpdate, 'Price lookup failed')
  const reviews = useEnrichmentAction(wine.id, fetchWineReviews, applyUpdate, 'Review lookup failed')

  // Price keeps its pre-existing auto-fetch-on-mount behavior (Phase 6) —
  // not new spend introduced here. Reviews stay click-gated (see §2 of the
  // Phase 9.3 spec): auto-firing them here would spend ~12–42 credits on
  // every scan/add regardless of whether the wine is kept.
  useEffect(() => {
    if (!wine.price_data) price.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleTag(tag: 'tag_wishlist' | 'tag_cellar') {
    const updated = { [tag]: !wine[tag] }
    setWine((prev) => ({ ...prev, ...updated }))
    onTagUpdate(wine.id, updated)
  }

  const primaryLine = [wine.producer, wine.denomination].filter(Boolean).join(' · ')
  const metaParts = [wine.vintage ? String(wine.vintage) : null, wine.region, wine.quality_classification].filter(Boolean)
  const criticScores = getDedupedCriticScores(wine.review_data)
  const { carried, totalConfigured } = summarizePreferredRetailers(wine.price_data)

  return (
    <div className="form-overlay">
      <div className="scan-result-card scan-enriching-card">

        {/* Header */}
        <div className="scan-result-header scan-result-header--saved">
          <div className="scan-saved-badge">✓ Saved to Collection</div>
        </div>

        {/* Wine identity */}
        <div className="scan-result-identity">
          <h2 className="scan-result-name">{primaryLine || 'Wine'}</h2>
          {metaParts.length > 0 && <p className="scan-result-meta">{metaParts.join(' · ')}</p>}
          {wine.grape_varieties && wine.grape_varieties.length > 0 && (
            <p className="scan-result-tier2">{wine.grape_varieties.join(', ')}</p>
          )}
        </div>

        {/* Reviews — first and most prominent action on this screen */}
        <div className="scan-enrichment-section">
          {criticScores.length > 0 && <CriticScoreBadges scores={criticScores} />}
          <div className="reviews-fetch-row">
            <button
              className="btn-fetch-price"
              onClick={() => reviews.run()}
              disabled={reviews.busy}
            >
              {reviews.busy ? 'Fetching…' : wine.review_data ? 'Refresh Reviews' : 'Fetch Reviews'}
            </button>
            {reviews.cachedAt && (
              <EnrichmentFreshness
                fetchedAt={reviews.cachedAt}
                label="Reviews"
                onRefreshAnyway={() => reviews.run({ force: true })}
                disabled={reviews.busy}
              />
            )}
            {reviews.error && <span className="price-error">{reviews.error}</span>}
          </div>
        </div>

        {/* Preferred-retailer carry-check — frontend-only, computed from the
            price fetch already in flight below. Zero new Serper cost. */}
        {wine.price_data && (
          <div className="scan-enrichment-section preferred-retailer-summary">
            {carried.length > 0 ? (
              <p>Carried by {carried.map((r) => r.name).join(', ')} — {carried.length} of {totalConfigured} preferred retailers</p>
            ) : (
              <p>Not yet seen at a preferred retailer</p>
            )}
          </div>
        )}

        {/* Price */}
        <div className="scan-enrichment-section">
          {price.busy && !wine.price_data && (
            <div className="scan-price-loading">
              <span className="scan-price-loading-icon">🔎</span>
              <span>Fetching prices from Retailer Crawl…</span>
            </div>
          )}

          {wine.price_data && (
            <>
              <PriceSection priceData={wine.price_data} wineId={wine.id} onWineUpdated={applyUpdate} />
              <button
                className="btn-fetch-price"
                onClick={() => price.run()}
                disabled={price.busy}
              >
                {price.busy ? 'Refreshing…' : 'Refresh Price'}
              </button>
              {price.cachedAt && (
                <EnrichmentFreshness
                  fetchedAt={price.cachedAt}
                  label="Price"
                  onRefreshAnyway={() => price.run({ force: true })}
                  disabled={price.busy}
                />
              )}
            </>
          )}

          {!price.busy && !wine.price_data && price.error && (
            <p className="scan-price-unavailable">{price.error}</p>
          )}
        </div>

        {/* List decision — tag_discovered is already set by default and isn't
            offered as a choice here; removing it entirely is still available
            from the wine's card/detail view. */}
        <div className="scan-enrichment-section">
          <div className="wine-tag-controls">
            {(['tag_wishlist', 'tag_cellar'] as const).map((tag) => (
              <button
                key={tag}
                className={`btn-tag-toggle ${wine[tag] ? 'active' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {wine[tag] ? '✓ ' : '+ '}{tag === 'tag_wishlist' ? 'Wishlist' : 'Cellar'}
              </button>
            ))}
          </div>
        </div>

        {/* Done */}
        <div className="scan-result-actions">
          <button className="btn-save btn-save--primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
