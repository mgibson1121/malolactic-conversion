/**
 * DiscoveryReview.tsx
 * Post-scan / post-add decision screen. Reached from both creation paths
 * (Scan Label and + Add Wine), and from Phase 9.4's duplicate check (WI-4)
 * when a scan matches a wine already in the collection.
 *
 * Section order matches the developer's stated priority: reviews first (the
 * signal that answers "is this worth keeping"), then whether a preferred
 * retailer carries it, then price, then the list decision. Built on Phase
 * 9.2's existing enrichment plumbing (useEnrichmentAction / fetchWinePrice /
 * fetchWineReviews) — no parallel fetch path, no parallel cache.
 *
 * Phase 9.4 — a scanned wine is a draft (wine.promoted_at === null) until
 * the developer picks at least one list tag and presses Save to Collection.
 * The screen renders two modes off that one field:
 *   - draft:     Discovered / Wishlist / Cellar multi-select, Save to
 *                Collection (disabled until a tag is picked), Discard.
 *   - promoted:  the pre-9.4 behaviour — Wishlist/Cellar toggle applied
 *                immediately via onTagUpdate, no Save/Discard controls.
 * (WI-4's duplicate match routes here with an already-promoted wine and
 * autoFireReviews=false — it's just being shown again, not created.)
 */

import { useEffect, useState } from 'react'
import type { UpdateWineInput, WineEntry } from '@shared/types'
import { RETAILER_CONFIG } from '@shared/config/retailers.config'
import { fetchWinePrice, fetchWineReviews } from '../api'
import { useEnrichmentAction } from '../hooks/useEnrichmentAction'
import { EnrichmentFreshness } from './EnrichmentFreshness'
import { PriceSection } from './PriceSection'
import { CriticScoreBadges } from './CriticScoreBadges'
import { getDedupedCriticScores } from '../utils/criticScores'
import { summarizePreferredRetailers } from '../utils/preferredRetailers'

const EXTENDED_RETAILER_COUNT = RETAILER_CONFIG.filter((r) => r.reviewTier === 'extended').length

interface Props {
  wine: WineEntry
  /** True only on the fresh-scan creation path (WI-6) — joins the
   * primary-tier reviews search already fired by LabelScanFlow. False for
   * manual add and for an existing wine shown via the duplicate check. */
  autoFireReviews?: boolean
  onDone: () => void
  /** Applies a tag change immediately — used only in promoted mode. */
  onTagUpdate: (id: string, tags: UpdateWineInput) => void
  onWineUpdated: (wine: WineEntry) => void
  /** Draft mode only. Resolves once the wine is promoted and the screen
   * should close. */
  onPromote?: (id: string, tags: { tag_discovered: boolean; tag_wishlist: boolean; tag_cellar: boolean }) => Promise<void>
  /** Draft mode only. Resolves once the wine is discarded and the screen
   * should close. */
  onDiscard?: (id: string) => Promise<void>
}

export function DiscoveryReview({
  wine: initialWine,
  autoFireReviews = false,
  onDone,
  onTagUpdate,
  onWineUpdated,
  onPromote,
  onDiscard,
}: Props) {
  const [wine, setWine] = useState(initialWine)
  const isDraft = wine.promoted_at === null
  const [draftTags, setDraftTags] = useState({
    tag_discovered: wine.tag_discovered,
    tag_wishlist: wine.tag_wishlist,
    tag_cellar: wine.tag_cellar,
  })
  const [promoting, setPromoting] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  function applyUpdate(updated: WineEntry) {
    setWine(updated)
    onWineUpdated(updated)
  }

  const price = useEnrichmentAction(wine.id, fetchWinePrice, applyUpdate, 'Price lookup failed')
  const reviews = useEnrichmentAction(wine.id, fetchWineReviews, applyUpdate, 'Review lookup failed')

  // Price keeps its pre-existing auto-fetch-on-mount behavior (Phase 6).
  // Reviews auto-fire only on the fresh-scan path (Phase 9.4, WI-6) — this
  // call joins whatever LabelScanFlow already started (or hits its TTL
  // cache) via the same coalescing key, rather than starting a second run.
  // Manual add and the duplicate-match path stay click-gated, as before.
  useEffect(() => {
    if (!wine.price_data) price.run()
    if (autoFireReviews && !wine.review_data) reviews.run({ tier: 'primary' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleTag(tag: 'tag_wishlist' | 'tag_cellar') {
    if (isDraft) {
      setDraftTags((prev) => ({ ...prev, [tag]: !prev[tag] }))
      return
    }
    const updated = { [tag]: !wine[tag] }
    setWine((prev) => ({ ...prev, ...updated }))
    onTagUpdate(wine.id, updated)
  }

  function toggleDraftDiscovered() {
    setDraftTags((prev) => ({ ...prev, tag_discovered: !prev.tag_discovered }))
  }

  const canPromote = draftTags.tag_discovered || draftTags.tag_wishlist || draftTags.tag_cellar

  async function handlePromote() {
    if (!onPromote || !canPromote) return
    setPromoting(true)
    try {
      await onPromote(wine.id, draftTags)
    } finally {
      setPromoting(false)
    }
  }

  async function handleDiscard() {
    if (!onDiscard) return
    setDiscarding(true)
    try {
      await onDiscard(wine.id)
    } finally {
      setDiscarding(false)
    }
  }

  const primaryLine = [wine.producer, wine.denomination].filter(Boolean).join(' · ')
  const metaParts = [wine.vintage ? String(wine.vintage) : null, wine.region, wine.quality_classification].filter(Boolean)
  const criticScores = getDedupedCriticScores(wine.review_data)
  const { carried, totalConfigured } = summarizePreferredRetailers(wine.price_data)

  const reviewsLabel = reviews.busy
    ? 'Fetching…'
    : criticScores.length > 0
      ? 'Refresh Reviews'
      : wine.review_data
        ? 'Search more retailers'
        : 'Fetch Reviews'

  return (
    <div className="form-overlay">
      <div className="scan-result-card scan-enriching-card">

        {/* Header */}
        <div className="scan-result-header scan-result-header--saved">
          {isDraft ? (
            <div className="scan-saved-badge scan-saved-badge--draft">Not yet saved — pick a list below</div>
          ) : (
            <div className="scan-saved-badge">✓ Saved to Collection</div>
          )}
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
              {reviewsLabel}
            </button>
            {reviewsLabel === 'Search more retailers' && (
              <p className="scan-result-tier2">Searches {EXTENDED_RETAILER_COUNT} more shops</p>
            )}
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

        {/* List decision */}
        <div className="scan-enrichment-section">
          <div className="wine-tag-controls">
            {isDraft && (
              <button
                className={`btn-tag-toggle ${draftTags.tag_discovered ? 'active' : ''}`}
                onClick={toggleDraftDiscovered}
              >
                {draftTags.tag_discovered ? '✓ ' : '+ '}Discovered
              </button>
            )}
            {(['tag_wishlist', 'tag_cellar'] as const).map((tag) => {
              const active = isDraft ? draftTags[tag] : wine[tag]
              return (
                <button
                  key={tag}
                  className={`btn-tag-toggle ${active ? 'active' : ''}`}
                  onClick={() => toggleTag(tag)}
                >
                  {active ? '✓ ' : '+ '}{tag === 'tag_wishlist' ? 'Wishlist' : 'Cellar'}
                </button>
              )
            })}
          </div>
        </div>

        {/* Done / Save / Discard */}
        <div className="scan-result-actions">
          {isDraft ? (
            <>
              <button className="btn-cancel" onClick={handleDiscard} disabled={discarding || promoting}>
                {discarding ? 'Discarding…' : 'Discard'}
              </button>
              <button
                className="btn-save btn-save--primary"
                onClick={handlePromote}
                disabled={!canPromote || promoting || discarding}
              >
                {promoting ? 'Saving…' : 'Save to Collection'}
              </button>
            </>
          ) : (
            <button className="btn-save btn-save--primary" onClick={onDone}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
