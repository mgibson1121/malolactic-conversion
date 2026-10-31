import type { WineEntry, UpdateWineInput } from '@shared/types'
import { fetchWinePrice, fetchWineReviews } from '../api'
import { useEnrichmentAction } from '../hooks/useEnrichmentAction'
import { EnrichmentRow } from './EnrichmentRow'
import { PriceBlock } from './PriceSection'
import { RetailerLinksSection } from './RetailerLinksSection'
import { cardBadge } from '../utils/criticBadge'
import { criticSummaryOf, windowStatusOfWine } from '../utils/wineDerived'

interface Props {
  wine: WineEntry
  activeTab: string
  onEvaluate: (wine: WineEntry) => void
  onTagUpdate: (id: string, tags: UpdateWineInput) => void
  onQuantityChange: (id: string, delta: number) => void
  onViewHistory: (wine: WineEntry) => void
  onWineUpdated: (wine: WineEntry) => void
  onViewDetail: (wine: WineEntry) => void
  onEdit: (wine: WineEntry) => void
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

export function WineCard({ wine, activeTab, onEvaluate, onTagUpdate, onQuantityChange, onViewHistory, onWineUpdated, onViewDetail, onEdit }: Props) {
  const price = useEnrichmentAction(wine.id, fetchWinePrice, onWineUpdated, 'Price lookup failed')
  const reviews = useEnrichmentAction(wine.id, fetchWineReviews, onWineUpdated, 'Review lookup failed')

  const badge = cardBadge(criticSummaryOf(wine))
  const windowStatus = windowStatusOfWine(wine)
  const primaryLine = [wine.producer, wine.denomination].filter(Boolean).join(' · ')
  const secondaryParts = [
    wine.vintage ? String(wine.vintage) : null,
    wine.region,
    wine.wine_color ? wine.wine_color[0].toUpperCase() + wine.wine_color.slice(1) : null,
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
      <button className="wine-name wine-name--clickable link" onClick={() => onViewDetail(wine)}>
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
            {wine.vintage_rating_source === 'derived' && (
              <span className="badge-tier badge-tier--derived" title="From automated review extraction, not manually entered">Sourced</span>
            )}
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
            My Review
          </button>
        )}

        <button className="btn-edit" onClick={() => onEdit(wine)}>
          Edit
        </button>

        {/* Evaluate — available on all wines */}
        <button className="btn-evaluate" onClick={() => onEvaluate(wine)}>
          Evaluate
        </button>
      </div>

      {/* Tag management. Discovered tab gets a lighter-weight quick add/
          remove row (design doc §3.3) rather than the full 4-way toggle —
          a Discovered wine's next move is usually just "wishlist it",
          "cellar it", or "not interested", not a trip into the detail
          modal. Every other tab keeps the full toggle row. */}
      {activeTab === 'discovered' ? (
        <div className="wine-tag-controls wine-tag-controls--quick">
          <button
            className={`btn-tag-toggle ${wine.tag_wishlist ? 'active' : ''}`}
            onClick={() => toggleTag('tag_wishlist')}
          >
            {wine.tag_wishlist ? '✓ ' : '+ '}Wishlist
          </button>
          <button
            className={`btn-tag-toggle ${wine.tag_cellar ? 'active' : ''}`}
            onClick={() => toggleTag('tag_cellar')}
          >
            {wine.tag_cellar ? '✓ ' : '+ '}Cellar
          </button>
          <button
            className="btn-tag-toggle btn-tag-toggle--remove"
            onClick={() => toggleTag('tag_discovered')}
          >
            ✕ Remove
          </button>
        </div>
      ) : (
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
      )}

      {/* Drinking window — the *primary* window only (Phase 12.1 WI-2): the
          developer's own, or the one derived from agreeing critics. A wine
          whose critics disagree and who has no window of its own is flagged
          "Check window" here, in the list view only; the per-critic windows
          are on the detail view, as reference. */}
      {wine.drinking_window ? (
        <div className="drinking-window">
          Drink {wine.drinking_window.start}–{wine.drinking_window.end}
          {wine.drinking_window_source === 'derived' && (
            <span className="badge-tier badge-tier--derived" title="From automated review extraction, not manually entered">Sourced</span>
          )}
        </div>
      ) : (
        windowStatus === 'check' && (
          <div className="drinking-window drinking-window--check">
            <button
              type="button"
              className="check-window-flag link"
              title="The critics disagree on this wine's window. Open it to see each critic's window, or set your own in Edit."
              onClick={() => onViewDetail(wine)}
            >
              Check window
            </button>
          </div>
        )
      )}

      {/* Critic reviews — the first score in the backend's order (Phase 12.1
          D13: trusted source, same vintage first) is the badge; the rest are
          "+N" and open the detail view. Nothing is averaged. */}
      <section className="card-section">
        <h4 className="card-section-title">Critic reviews</h4>
        {badge && (
          <button
            type="button"
            className="card-score-badge"
            onClick={() => onViewDetail(wine)}
            title={`${badge.item.publication} — open for every score`}
          >
            <span className={`critic-score-badge${badge.known ? '' : ' critic-score-badge--unknown'}`}>
              <span className="critic-score">{badge.score}</span>
              <span className="critic-publication">{badge.label}</span>
              {badge.yearTag && <span className="critic-attribute critic-year-tag">{badge.yearTag}</span>}
            </span>
            {badge.additional > 0 && <span className="card-score-more link">+{badge.additional}</span>}
          </button>
        )}
        <EnrichmentRow
          action={reviews}
          label={wine.review_data ? 'Refresh Reviews' : 'Fetch Reviews'}
          busyLabel="Fetching…"
          freshnessLabel="Reviews"
          hasData={!!wine.review_data}
        />
      </section>

      {/* Price & retailers */}
      <PriceBlock wine={wine} action={price} onWineUpdated={onWineUpdated} variant="card" />

      <RetailerLinksSection wine={wine} onWineUpdated={onWineUpdated} />
    </div>
  )
}
