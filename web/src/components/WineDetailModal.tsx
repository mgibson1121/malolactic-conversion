/**
 * WineDetailModal.tsx
 * Full-screen detail overlay for a wine entry.
 * Shows all identity fields, tags, cellar quantity, drinking window,
 * Wine-Searcher price section, and tasting notes summary.
 */

import { useEffect, useState } from 'react'
import type { TastingNote, UpdateWineInput, WineEntry } from '@shared/types'
import { fetchWinePrice, listTastingNotesByWine } from '../api'
import { PriceSection } from './PriceSection'
import { RetailerLinksSection } from './RetailerLinksSection'

interface Props {
  wine: WineEntry
  onClose: () => void
  onTagUpdate: (id: string, tags: UpdateWineInput) => void
  onQuantityChange: (id: string, delta: number) => void
  onEvaluate: (wine: WineEntry) => void
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

const RETAILER_LABELS: Record<string, string> = {
  kl: 'K&L',
  zachys: 'Zachys',
  woodland: 'Woodland Hills',
  benchmark: 'Benchmark',
}

const QUALITY_LABELS: Record<string, string> = {
  flawed: 'Flawed',
  poor: 'Poor',
  acceptable: 'Acceptable',
  good: 'Good',
  very_good: 'Very Good',
  outstanding: 'Outstanding',
}

export function WineDetailModal({
  wine: initialWine,
  onClose,
  onTagUpdate,
  onQuantityChange,
  onEvaluate,
  onWineUpdated,
}: Props) {
  const [wine, setWine] = useState(initialWine)
  const [notes, setNotes] = useState<TastingNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [fetchingPrice, setFetchingPrice] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)

  // Keep local wine in sync if parent updates it
  useEffect(() => { setWine(initialWine) }, [initialWine])

  // Fetch tasting notes on open
  useEffect(() => {
    if (!wine.latest_tasting_note_id) return
    setNotesLoading(true)
    listTastingNotesByWine(wine.id)
      .then(setNotes)
      .catch(() => {})
      .finally(() => setNotesLoading(false))
  }, [wine.id, wine.latest_tasting_note_id])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleFetchPrice() {
    setFetchingPrice(true)
    setPriceError(null)
    try {
      const updated = await fetchWinePrice(wine.id)
      setWine(updated)
      onWineUpdated(updated)
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : 'Price lookup failed')
    } finally {
      setFetchingPrice(false)
    }
  }

  function handleTagToggle(tag: 'tag_discovered' | 'tag_wishlist' | 'tag_cellar' | 'tag_consumed') {
    const updated = { [tag]: !wine[tag] }
    // Optimistic local update
    setWine(prev => ({ ...prev, ...updated }))
    onTagUpdate(wine.id, updated)
  }

  function handleQtyChange(delta: number) {
    const newQty = Math.max(0, wine.cellar_quantity + delta)
    setWine(prev => ({ ...prev, cellar_quantity: newQty }))
    onQuantityChange(wine.id, delta)
  }

  const primaryLine = [wine.producer, wine.denomination].filter(Boolean).join(' · ')

  const identityMeta = [
    wine.vintage ? String(wine.vintage) : null,
    wine.region,
    wine.quality_classification,
  ].filter(Boolean).join(' · ')

  const tier2 = [
    wine.vineyard,
    wine.cuvee,
    wine.grape_varieties?.join(', '),
  ].filter(Boolean)

  const activeTags = (['tag_discovered', 'tag_wishlist', 'tag_cellar', 'tag_consumed'] as const).filter(t => wine[t])

  const latestNote = notes[0] ?? null

  return (
    <div className="detail-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="detail-modal" role="dialog" aria-modal="true" aria-label={primaryLine}>

        {/* ── Sticky header ─────────────────────────────────────────── */}
        <div className="detail-header">
          <div className="detail-header-title">
            <span className="detail-producer">{wine.producer ?? '—'}</span>
            {wine.denomination && <span className="detail-denomination">{wine.denomination}</span>}
          </div>
          <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── Scrollable body ───────────────────────────────────────── */}
        <div className="detail-body">

          {/* Identity section */}
          <section className="detail-section detail-identity">
            {wine.label_image_url && (
              <img src={wine.label_image_url} alt="Wine label" className="detail-label-image" />
            )}
            <div className="detail-identity-text">
              <h2 className="detail-wine-name">{primaryLine || '—'}</h2>
              {identityMeta && <p className="detail-identity-meta">{identityMeta}</p>}
              {tier2.map((v, i) => (
                <p key={i} className="detail-tier2-field">{v}</p>
              ))}
              {wine.my_rating && (
                <span className={`rating-badge rating-${wine.my_rating}`}>
                  {RATING_LABELS[wine.my_rating]}
                </span>
              )}
            </div>
          </section>

          {/* Tags section */}
          <section className="detail-section">
            <h3 className="detail-section-title">Lists</h3>
            <div className="detail-tag-pills">
              {activeTags.length > 0 && (
                <div className="detail-active-tags">
                  {activeTags.map(tag => (
                    <span key={tag} className={`tag-badge tag-${tag.replace('tag_', '')}`}>
                      {TAG_LABELS[tag]}
                    </span>
                  ))}
                </div>
              )}
              <div className="detail-tag-toggles">
                {(['tag_discovered', 'tag_wishlist', 'tag_cellar', 'tag_consumed'] as const).map(tag => (
                  <button
                    key={tag}
                    className={`btn-tag-toggle ${wine[tag] ? 'active' : ''}`}
                    onClick={() => handleTagToggle(tag)}
                  >
                    {wine[tag] ? '✓ ' : '+ '}{TAG_LABELS[tag]}
                  </button>
                ))}
              </div>
            </div>

            {/* Cellar quantity — shown when tag_cellar is active */}
            {wine.tag_cellar && (
              <div className="detail-cellar-row">
                <span className="detail-field-label">Cellar quantity</span>
                <div className="quantity-controls">
                  <button
                    className="btn-qty"
                    onClick={() => handleQtyChange(-1)}
                    disabled={wine.cellar_quantity <= 0}
                    aria-label="Remove one bottle"
                  >−</button>
                  <span className="qty-display">{wine.cellar_quantity} btl</span>
                  <button
                    className="btn-qty"
                    onClick={() => handleQtyChange(1)}
                    aria-label="Add one bottle"
                  >+</button>
                </div>
              </div>
            )}
          </section>

          {/* Review links — saved retailer URLs only; generated search links
              live in the Find Reviews section below Pricing. Omitted entirely
              if nothing has been saved. */}
          {wine.retailer_links && Object.keys(wine.retailer_links).length > 0 && (
            <section className="detail-section">
              <h3 className="detail-section-title">Review Links</h3>
              <div className="detail-review-links">
                {Object.entries(wine.retailer_links).map(([slug, url]) => (
                  <a
                    key={slug}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="retailer-link"
                  >
                    {RETAILER_LABELS[slug] ?? slug} review
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Drinking window */}
          {wine.drinking_window && (
            <section className="detail-section">
              <h3 className="detail-section-title">Drinking Window</h3>
              <p className="detail-drinking-window">
                {wine.drinking_window.start} – {wine.drinking_window.end}
              </p>
            </section>
          )}

          {/* Price section */}
          <section className="detail-section">
            <h3 className="detail-section-title">Pricing</h3>
            {wine.price_data ? (
              <>
                <PriceSection priceData={wine.price_data} />
                <button
                  className="btn-fetch-price"
                  onClick={handleFetchPrice}
                  disabled={fetchingPrice}
                >
                  {fetchingPrice ? 'Refreshing…' : 'Refresh Price'}
                </button>
              </>
            ) : (
              <div className="price-fetch-prompt">
                <p className="detail-empty-hint">No price data yet.</p>
                <button
                  className="btn-fetch-price"
                  onClick={handleFetchPrice}
                  disabled={fetchingPrice}
                >
                  {fetchingPrice ? 'Fetching…' : 'Fetch Price'}
                </button>
                {priceError && <span className="price-error">{priceError}</span>}
              </div>
            )}
          </section>

          {/* Find / save retailer review links */}
          <section className="detail-section">
            <h3 className="detail-section-title">Find Reviews</h3>
            <RetailerLinksSection wine={wine} onWineUpdated={(updated) => { setWine(updated); onWineUpdated(updated) }} />
          </section>

          {/* Tasting notes */}
          <section className="detail-section">
            <h3 className="detail-section-title">
              Tasting Notes {notes.length > 0 && <span className="detail-note-count">({notes.length})</span>}
            </h3>

            {notesLoading && <p className="detail-loading">Loading notes…</p>}

            {!notesLoading && latestNote && (
              <div className="detail-latest-note">
                <div className="detail-note-meta">
                  {latestNote.my_rating && (
                    <span className={`rating-badge rating-${latestNote.my_rating}`}>
                      {RATING_LABELS[latestNote.my_rating]}
                    </span>
                  )}
                  {latestNote.quality_assessment && (
                    <span className="detail-note-quality">{QUALITY_LABELS[latestNote.quality_assessment] ?? latestNote.quality_assessment}</span>
                  )}
                  <span className="detail-note-date">
                    {new Date(latestNote.tasted_at).toLocaleDateString()}
                  </span>
                </div>

                {latestNote.free_text && (
                  <p className="detail-note-excerpt">{latestNote.free_text.slice(0, 200)}{latestNote.free_text.length > 200 ? '…' : ''}</p>
                )}

                {latestNote.tags.length > 0 && (
                  <div className="detail-note-tags">
                    {latestNote.tags.slice(0, 6).map((t, i) => (
                      <span key={i} className="note-tag-chip">{t}</span>
                    ))}
                  </div>
                )}

                {notes.length > 1 && (
                  <p className="detail-more-notes">{notes.length - 1} more note{notes.length > 2 ? 's' : ''}</p>
                )}
              </div>
            )}

            {!notesLoading && !latestNote && (
              <p className="detail-empty-hint">No tasting notes yet.</p>
            )}
          </section>

          {/* Evaluate CTA */}
          <section className="detail-section detail-actions-section">
            <button
              className="btn-evaluate btn-evaluate--large"
              onClick={() => { onClose(); onEvaluate(wine) }}
            >
              Evaluate This Wine
            </button>
          </section>

        </div>
      </div>
    </div>
  )
}
