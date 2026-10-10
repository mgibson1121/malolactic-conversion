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
import { claimPriceOnce, hasAttemptedPrice } from '../utils/priceOnce'
import { CriticReviewsBlock } from './CriticReviewsBlock'
import { EnrichmentRow } from './EnrichmentRow'
import { PriceBlock } from './PriceSection'
import { criticSummaryOf } from '../utils/wineDerived'
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

function ListRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`list-row${on ? ' list-row--on' : ''}`} aria-pressed={on} onClick={onToggle}>
      <span className="list-row-circle" aria-hidden="true">{on ? '✓' : ''}</span>
      {label}
    </button>
  )
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

  // Price follows the fetch-once rule (developer decision 2026-09-26,
  // utils/priceOnce.ts): priced automatically only if it has never been, and
  // at most once per session even when that attempt fails.
  // Reviews auto-fire only on the fresh-scan path (Phase 9.4, WI-6) — this
  // call joins whatever LabelScanFlow already started (or hits its TTL
  // cache) via the same coalescing key, rather than starting a second run.
  // Manual add and the duplicate-match path stay click-gated, as before.
  useEffect(() => {
    if (claimPriceOnce(wine)) price.run()
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
  const hasScores = criticSummaryOf(wine).ordered.length > 0
  const { carried, totalConfigured } = summarizePreferredRetailers(wine.price_data)

  const reviewsLabel = hasScores ? 'Refresh Reviews' : wine.review_data ? 'Search more retailers' : 'Fetch Reviews'
  // A fresh scan has its primary-tier lookup under way until a result or an
  // error arrives (Phase 12.1 WI-4): the block says "Looking…", not nothing.
  const reviewsUnderWay = autoFireReviews && !wine.review_data
  // A wine that has never been priced is about to be (fetch-once rule).
  const priceUnderWay = !wine.price_data && !hasAttemptedPrice(wine.id)

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

        {/* Critic reviews — first and most prominent block on this screen.
            Four explicit states, never a vanishing block (Phase 12.1 WI-4). */}
        <div className="scan-enrichment-section">
          <h3 className="preview-section-title">Critic reviews</h3>
          <CriticReviewsBlock wine={wine} action={reviews} lookupUnderWay={reviewsUnderWay} />
          <EnrichmentRow
            kind="reviews"
            action={reviews}
            label={reviewsLabel}
            busyLabel="Fetching…"
            freshnessLabel="Reviews"
            hasData={!!wine.review_data}
            note={
              reviewsLabel === 'Search more retailers' ? (
                <p className="scan-result-tier2">Searches {EXTENDED_RETAILER_COUNT} more shops</p>
              ) : undefined
            }
          />
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

        {/* Price & retailers */}
        <div className="scan-enrichment-section">
          <PriceBlock
            wine={wine}
            action={price}
            onWineUpdated={applyUpdate}
            variant="preview"
            lookupUnderWay={priceUnderWay}
          />
        </div>

        {/* List decision (Phase 12.1 WI-6): every row looks selectable — an
            empty circle when off, a filled one when on — and the hint says
            what is needed, next to the picker rather than under a disabled
            button. */}
        <div className="scan-enrichment-section">
          <h3 className="preview-section-title">Add to which list?</h3>
          <div className="list-picker" role="group" aria-label="Add to which list?">
            {isDraft && (
              <ListRow label="Discovered" on={draftTags.tag_discovered} onToggle={toggleDraftDiscovered} />
            )}
            {(['tag_wishlist', 'tag_cellar'] as const).map((tag) => (
              <ListRow
                key={tag}
                label={tag === 'tag_wishlist' ? 'Wishlist' : 'Cellar'}
                on={isDraft ? draftTags[tag] : wine[tag]}
                onToggle={() => toggleTag(tag)}
              />
            ))}
          </div>
          {isDraft && !canPromote && <p className="pick-list-hint">Pick at least one list to save.</p>}
        </div>

        {/* Done / Save / Discard */}
        <div className="scan-result-actions">
          {isDraft ? (
            <>
              <button className="btn-cancel" onClick={handleDiscard} disabled={discarding || promoting}>
                {discarding ? 'Discarding…' : 'Discard'}
              </button>
              <button
                className={`btn-save btn-save--primary${canPromote ? '' : ' btn-save--inactive'}`}
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
