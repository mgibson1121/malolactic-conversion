import { useState } from 'react'
import type { WineEntry, UpdateWineInput } from '@shared/types'
import { fetchWinePrice } from '../api'
import { PriceSection } from './PriceSection'

interface Props {
  wine: WineEntry
  activeTab: string
  onEvaluate: (wine: WineEntry) => void
  onTagUpdate: (id: string, tags: UpdateWineInput) => void
  onQuantityChange: (id: string, delta: number) => void
  onViewHistory: (wine: WineEntry) => void
  onWineUpdated: (wine: WineEntry) => void
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

export function WineCard({ wine, activeTab, onEvaluate, onTagUpdate, onQuantityChange, onViewHistory, onWineUpdated }: Props) {
  const [fetchingPrice, setFetchingPrice] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)

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
      <div className="wine-name">{primaryLine || '—'}</div>

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
    </div>
  )
}
