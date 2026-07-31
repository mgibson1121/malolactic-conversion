import { useState } from 'react'
import type { WineEntry, UpdateWineInput } from '@shared/types'
import { fetchWinePrice, fetchWineReviews } from '../api'
import { PriceSection } from './PriceSection'
import { RetailerLinksSection } from './RetailerLinksSection'
import { CriticScoreBadges } from './CriticScoreBadges'
import { getDedupedCriticScores } from '../utils/criticScores'

interface Props {
  wine: WineEntry
  activeTab: string
  onEvaluate: (wine: WineEntry) => void
  onTagUpdate: (id: string, tags: UpdateWineInput) => void
  onQuantityChange: (id: string, delta: number) => void
  onViewHistory: (wine: WineEntry) => void
  onWineUpdated: (wine: WineEntry) => void
  onViewDetail: (wine: WineEntry) => void
}

const TAG_LABELS: Record<string, string> = {
  tag_discovered: 'Discovered',
  tag_wishlist: 'Wishlist',
  tag_cellar: 'Cellar',
  tag_consumed: 'Consumed',
}

const RATING_LABELS: Record<string, string> = {
  poor: 'Poor',
  acceptable: 'Acceptable',
  good: 'Good',
  very_good: 'Very Good',
  outstanding: 'Outstanding',
}

// vintage_rating is displayed as "Year" in the UI — developer preference,
// not a field rename (see build-phases.md Phase 8).
const VINTAGE_RATING_LABELS: Record<string, string> = {
  below_avg: 'Below Average',
  avg: 'Average',
  good: 'Good',
  very_good: 'Very Good',
}

export function WineCard({ wine, activeTab, onEvaluate, onTagUpdate, onQuantityChange, onViewHistory, onWineUpdated, onViewDetail }: Props) {
  const [fetchingPrice, setFetchingPrice] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [fetchingReviews, setFetchingReviews] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)

  async function handleFetchPrice() {
    setFetchingPrice(true)
    setPriceError(null)
    try {
      const updated = await fetchWinePrice(wine.id)
      onWineUpdated(updated)
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : 'Price lookup failed')
    } finally {
      setFetchingPrice(false)
    }
  }

  async function handleFetchReviews() {
    setFetchingReviews(true)
    setReviewsError(null)
    try {
      const updated = await fetchWineReviews(wine.id)
      onWineUpdated(updated)
    } catch (err) {
      setReviewsError(err instanceof Error ? err.message : 'Review lookup failed')
    } finally {
      setFetchingReviews(false)
    }
  }

  const criticScores = getDedupedCriticScores(wine.review_data)
  const primaryLine = [wine.producer, wine.denomination].filter(Boolean).join(' · ')
  const secondaryParts = [
    wine.vintage ? String(wine.vintage) : null,
    wine.region,
    wine.cuvee,
    wine.quality_classification,
    wine.grape_varieties && wine.grape_varieties.length > 0 ? wine.grape_varieties.join(', ') : null,
  ].filter(Boolean)

  const activeTags = (['tag_discovered', 'tag_wishlist', 'tag_cellar', 'tag_consumed'] as const).filter(
    (t) => wine[t]
  )

  function toggleTag(tag: keyof typeof TAG_LABELS) {
    onTagUpdate(wine.id, { [tag]: !wine[tag as keyof WineEntry] })
  }

  return (
    <div className="wine-card">
      <button className="wine-name wine-name--clickable" onClick={() => onViewDetail(wine)}>
        {primaryLine || '—'}
      </button>

      <div className="wine-meta">
        {secondaryParts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="sep">·</span>}
            {part}
          </span>
        ))}
        {wine.my_rating && (
          <span className={`rating-badge rating-${wine.my_rating}`}>
            {RATING_LABELS[wine.my_rating]}
          </span>
        )}
        {wine.vintage_rating && (
          <span
            className={`vintage-rating-badge vintage-rating-${wine.vintage_rating}`}
            title="Vintage character, from professional review extraction — never blended across disagreeing critics"
          >
            Year: {VINTAGE_RATING_LABELS[wine.vintage_rating]}
          </span>
        )}
      </div>

      {/* Active tag badges */}
      <div className="wine-tags">
        {activeTags.map((tag) => (
          <span key={tag} className={`tag-badge tag-${tag.replace('tag_', '')}`}>
            {TAG_LABELS[tag]}
          </span>
        ))}
      </div>

      <div className="wine-card-actions">
        {/* Cellar quantity controls — only on Cellar tab */}
        {activeTab === 'cellar' && wine.tag_cellar && (
          <div className="quantity-controls">
            <button
              className="btn-qty"
              onClick={() => onQuantityChange(wine.id, -1)}
              disabled={wine.cellar_quantity <= 0}
              aria-label="Remove one bottle"
            >
              −
            </button>
            <span className="qty-display">{wine.cellar_quantity} btl</span>
            <button
              className="btn-qty"
              onClick={() => onQuantityChange(wine.id, 1)}
              aria-label="Add one bottle"
            >
              +
            </button>
          </div>
        )}

        {/* View review history — any wine with at least one note */}
        {wine.latest_tasting_note_id && (
          <button className="btn-history" onClick={() => onViewHistory(wine)}>
            Reviews
          </button>
        )}

        {/* Evaluate — available on all wines */}
        <button className="btn-evaluate" onClick={() => onEvaluate(wine)}>
          Evaluate
        </button>
      </div>

      {/* Tag management — toggle any tag */}
      <div className="wine-tag-controls">
        {(['tag_discovered', 'tag_wishlist', 'tag_cellar', 'tag_consumed'] as const).map((tag) => (
          <button
            key={tag}
            className={`btn-tag-toggle ${wine[tag] ? 'active' : ''}`}
            onClick={() => toggleTag(tag)}
          >
            {wine[tag] ? '✓ ' : '+ '}{TAG_LABELS[tag]}
          </button>
        ))}
      </div>

      {/* Drinking window */}
      {wine.drinking_window && (
        <div className="drinking-window">
          Drink {wine.drinking_window.start}–{wine.drinking_window.end}
        </div>
      )}

      {/* Critic scores — sourced from review_data (Phase 7), a rendered
          single product page per retailer, never price_data's guaranteed-
          empty critic_scores. Each badge carries the number, the publication,
          and any coded attributes (drinking window, vintage character, value
          signal) the source text stated for that citation — see Phase 8. */}
      {criticScores.length > 0 && <CriticScoreBadges scores={criticScores} />}
      <div className="reviews-fetch-row">
        <button
          className="btn-fetch-price"
          onClick={handleFetchReviews}
          disabled={fetchingReviews}
        >
          {fetchingReviews ? 'Fetching…' : wine.review_data ? 'Refresh Reviews' : 'Fetch Reviews'}
        </button>
        {reviewsError && <span className="price-error">{reviewsError}</span>}
      </div>

      {/* Price data from Wine-Searcher */}
      {wine.price_data ? (
        <div>
          <PriceSection priceData={wine.price_data} />
          <button
            className="btn-fetch-price"
            onClick={handleFetchPrice}
            disabled={fetchingPrice}
          >
            {fetchingPrice ? 'Refreshing…' : 'Refresh Price'}
          </button>
        </div>
      ) : (
        <div className="price-fetch-prompt">
          <button
            className="btn-fetch-price"
            onClick={handleFetchPrice}
            disabled={fetchingPrice}
          >
            {fetchingPrice ? 'Fetching price…' : 'Fetch Price'}
          </button>
          {priceError && <span className="price-error">{priceError}</span>}
        </div>
      )}

      <RetailerLinksSection wine={wine} onWineUpdated={onWineUpdated} />
    </div>
  )
}
