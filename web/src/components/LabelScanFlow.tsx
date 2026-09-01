/**
 * LabelScanFlow.tsx
 * Full scan-to-review flow (Phase 9.4 — scan-first enrichment):
 *   1. File upload (drag-and-drop or click)
 *   2. Scanning state (progress indicator)
 *   3. Free duplicate check against the wines already in the collection
 *      (WI-4) — a confident match skips straight to that wine's review
 *      screen, spending nothing.
 *   4. A new wine is a draft row from the moment parsing succeeds (WI-1) —
 *      created here, immediately, before the user has confirmed anything.
 *      Price and the primary review tier fire in the background the same
 *      moment (WI-6), so the seconds spent verifying fields below double as
 *      the seconds the search needs.
 *   5. Scan result card — visual preview of detected fields, now a PATCH
 *      form over the real row rather than a CreateWineInput builder.
 *      "Edit Details" expands the full inline form for any adjustments.
 *   6. Continue — hands off to the shared Discovery Review screen (see
 *      App.tsx), which is where the developer actually decides whether the
 *      wine joins the collection.
 */

import { useState, useRef, DragEvent, ChangeEvent } from 'react'
import type { CreateWineInput, UpdateWineInput, WineEntry } from '@shared/types'
import { createWine, deleteWine, fetchWinePrice, fetchWineReviews, scanLabel, updateWine } from '../api'
import type { LabelScanResult } from '../api'
import { findDuplicate } from '../utils/duplicateMatch'

interface Props {
  /** Promoted wines already in the collection — used only for the free
   * duplicate check (WI-4). Fetched fresh by App.tsx when this flow opens;
   * no additional cost to load it here. */
  wines: WineEntry[]
  /** Called once there is a wine to review — either a newly created draft or
   * an existing wine a duplicate check matched. autoFireReviews tells the
   * Discovery Review screen whether to join the primary-tier reviews search
   * already under way (true for a fresh scan) or stay click-gated (false
   * for an existing wine the developer is just being shown again). */
  onReview: (wine: WineEntry, autoFireReviews: boolean) => void
  /** Called when the user cancels before reaching the review screen, or
   * closes out of it. Any draft created along the way is discarded first. */
  onDone: () => void
}

type FlowState =
  | { step: 'upload' }
  | { step: 'scanning' }
  | { step: 'unavailable'; reason: string }
  | { step: 'duplicate'; existing: WineEntry; scan: LabelScanResult }
  | { step: 'review'; wine: WineEntry; scan: LabelScanResult; editing: boolean; enrichmentFired: boolean; vintageNotice: string | null }
  | { step: 'error'; message: string }

/** The five fields a re-fire on Continue is judged against (WI-6, step 5).
 * Region and Tier 2 fields other than cuvee/vineyard never re-fire — they
 * don't change which wine the search is looking for. */
const IDENTITY_FIELDS = ['producer', 'denomination', 'vintage', 'cuvee', 'vineyard'] as const

function hasTier1(fields: { producer: string | null; denomination: string | null; vintage: number | null }): boolean {
  return !!(fields.producer && fields.denomination && fields.vintage)
}

function scanToDraftInput(scan: LabelScanResult): CreateWineInput {
  return {
    producer: scan.producer,
    vintage: scan.vintage,
    region: scan.region,
    denomination: scan.denomination,
    quality_classification: scan.quality_classification,
    vineyard: scan.vineyard,
    cuvee: scan.cuvee,
    grape_varieties: scan.grape_varieties,
    label_image_url: null,
    // Phase 9.4 — every creation path starts as a draft with no list tag.
    // The developer picks at least one on the Discovery Review screen.
    tag_discovered: false,
    tag_wishlist: false,
    tag_cellar: false,
    tag_consumed: false,
    cellar_quantity: 0,
    cellar_category: null,
    drinking_window: null,
    vintage_rating: null,
    my_rating: null,
    my_tags: [],
    wishlist_notes: null,
    price_paid: null,
    purchased_from: null,
    date_first_consumed: null,
  }
}

export function LabelScanFlow({ wines, onReview, onDone }: Props) {
  const [flow, setFlow] = useState<FlowState>({ step: 'upload' })
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fire-and-forget — errors surface later, via the Discovery Review
  // screen's own busy/error state when it joins the same (coalesced) run.
  // This call exists purely to start the clock early (WI-6, §1).
  function fireEnrichment(wine: { id: string; producer: string | null; denomination: string | null; vintage: number | null }, opts?: { force?: boolean }) {
    if (!hasTier1(wine)) return
    fetchWinePrice(wine.id, opts).catch(() => {})
    fetchWineReviews(wine.id, { tier: 'primary', ...opts }).catch(() => {})
  }

  async function discardDraft() {
    if (flow.step === 'review') {
      await deleteWine(flow.wine.id).catch(() => {})
    }
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setFlow({ step: 'error', message: 'Please select an image file.' })
      return
    }

    setFlow({ step: 'scanning' })

    try {
      const scan = await scanLabel(file)

      // WI-4 — free duplicate check, before any row is created or any
      // enrichment call fired.
      const dup = findDuplicate(scan, wines)
      if (dup.kind === 'duplicate') {
        setFlow({ step: 'duplicate', existing: dup.wine, scan })
        return
      }

      await createDraftAndReview(scan, dup.kind === 'vintage_mismatch' ? dup.wine : null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('openai_api_key') || msg.toLowerCase().includes('unavailable')) {
        setFlow({
          step: 'unavailable',
          reason: 'Label scanning is unavailable — OPENAI_API_KEY is not configured on the backend.',
        })
      } else if (msg.includes('IMAGE_FORMAT_UNSUPPORTED')) {
        setFlow({
          step: 'error',
          message: "This image format couldn't be processed. Please save the photo as a JPEG and try again.",
        })
      } else {
        setFlow({ step: 'error', message: `Scan failed: ${msg}` })
      }
    }
  }

  async function createDraftAndReview(scan: LabelScanResult, distinctFrom: WineEntry | null) {
    const wine = await createWine(scanToDraftInput(scan))
    const fired = hasTier1(wine)
    if (fired) fireEnrichment(wine)
    setFlow({
      step: 'review',
      wine,
      scan,
      editing: false,
      enrichmentFired: fired,
      vintageNotice: distinctFrom
        ? `You already have the ${distinctFrom.vintage ?? 'NV'} — this looks like the ${scan.vintage ?? 'NV'}.`
        : null,
    })
  }

  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  async function handleCancel() {
    await discardDraft()
    onDone()
  }

  async function handleRetry() {
    await discardDraft()
    setFlow({ step: 'upload' })
  }

  // ── Upload step ──────────────────────────────────────────────────────────────
  if (flow.step === 'upload') {
    return (
      <div className="form-overlay">
        <div className="scan-flow">
          <h2>Scan Wine Label</h2>
          <p className="scan-subtitle">
            Upload a photo of the bottle label — GPT-4o will extract the details.
          </p>
          <div
            className={`scan-dropzone${dragOver ? ' drag-over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
            aria-label="Upload wine label photo"
          >
            <span className="scan-dropzone-icon">📷</span>
            <p>Click to select a photo<br /><span className="scan-dropzone-hint">or drag and drop here</span></p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onFileInput}
            />
          </div>
          <div className="form-actions">
            <button className="btn-cancel" onClick={onDone}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Scanning step ────────────────────────────────────────────────────────────
  if (flow.step === 'scanning') {
    return (
      <div className="form-overlay">
        <div className="scan-flow scan-flow--scanning">
          <span className="scan-spinner" aria-hidden="true">🔍</span>
          <h2>Scanning label…</h2>
          <p>GPT-4o is reading the label. This usually takes 5–15 seconds.</p>
        </div>
      </div>
    )
  }

  // ── Unavailable step ─────────────────────────────────────────────────────────
  if (flow.step === 'unavailable') {
    return (
      <div className="form-overlay">
        <div className="scan-flow">
          <h2>Scan Unavailable</h2>
          <p className="error-msg">{flow.reason}</p>
          <p>You can still add wines manually using the <strong>+ Add Wine</strong> button.</p>
          <div className="form-actions">
            <button className="btn-cancel" onClick={onDone}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Error step ───────────────────────────────────────────────────────────────
  if (flow.step === 'error') {
    return (
      <div className="form-overlay">
        <div className="scan-flow">
          <h2>Scan Failed</h2>
          <p className="error-msg">{flow.message}</p>
          <div className="form-actions">
            <button className="btn-cancel" onClick={() => setFlow({ step: 'upload' })}>Try Again</button>
            <button className="btn-cancel" onClick={onDone}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Duplicate step (WI-4) ────────────────────────────────────────────────────
  if (flow.step === 'duplicate') {
    const { existing, scan } = flow
    const line = [existing.producer, existing.denomination].filter(Boolean).join(' · ')

    async function addAnyway() {
      if (flow.step !== 'duplicate') return
      setFlow({ step: 'scanning' })
      await createDraftAndReview(flow.scan, null)
    }

    return (
      <div className="form-overlay">
        <div className="scan-flow">
          <h2>Already in Your Collection</h2>
          <p className="scan-subtitle">
            {line} {existing.vintage ?? 'NV'} looks like a wine you already have — no search has been run.
          </p>
          <div className="form-actions">
            <button className="btn-save btn-save--primary" onClick={() => onReview(existing, false)}>
              View Existing Wine
            </button>
            <button className="btn-text" onClick={addAnyway}>This is a different bottle — add anyway</button>
            <button className="btn-cancel" onClick={onDone}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Review step ──────────────────────────────────────────────────────────────
  const { wine, scan, editing, enrichmentFired, vintageNotice } = flow

  async function handleContinue(edits: UpdateWineInput) {
    if (flow.step !== 'review') return
    const base = flow.wine
    const updated = Object.keys(edits).length > 0 ? await updateWine(base.id, edits) : base

    const identityChanged = IDENTITY_FIELDS.some((f) => {
      const key = f as keyof UpdateWineInput
      return edits[key] !== undefined && edits[key] !== base[f]
    })

    // WI-6, steps 4/5 — fire for the first time once Tier 1 is complete
    // (held earlier if it wasn't), or re-fire when an identity field
    // changed from what was already searched. Otherwise the in-flight or
    // already-stored result from creation-time still applies unchanged.
    if (hasTier1(updated) && (!enrichmentFired || identityChanged)) {
      fireEnrichment(updated, { force: enrichmentFired })
    }

    onReview(updated, true)
  }

  if (editing) {
    return (
      <ScanEditForm
        wine={wine}
        scan={scan}
        vintageNotice={vintageNotice}
        onContinue={handleContinue}
        onBack={() => setFlow({ ...flow, editing: false })}
        onCancel={handleCancel}
      />
    )
  }

  return (
    <ScanResultCard
      wine={wine}
      scan={scan}
      vintageNotice={vintageNotice}
      onContinue={handleContinue}
      onEdit={() => setFlow({ ...flow, editing: true })}
      onRetry={handleRetry}
      onCancel={handleCancel}
    />
  )
}

// ── ScanResultCard ─────────────────────────────────────────────────────────────
// Visual card showing scan results, bound to the already-created draft row.
// Missing Tier 1 fields get inline inputs; everything else needs Edit Details.

interface ResultCardProps {
  wine: WineEntry
  scan: LabelScanResult
  vintageNotice: string | null
  onContinue: (edits: UpdateWineInput) => Promise<void>
  onEdit: () => void
  onRetry: () => void
  onCancel: () => void
}

function ScanResultCard({ wine, scan, vintageNotice, onContinue, onEdit, onRetry, onCancel }: ResultCardProps) {
  const missing = new Set(scan.missing_tier1_fields)

  // Only collect inline inputs for missing Tier 1 fields
  const [producer, setProducer] = useState(scan.producer ?? '')
  const [vintage, setVintage] = useState(scan.vintage ? String(scan.vintage) : '')
  const [region, setRegion] = useState(scan.region ?? '')
  const [denomination, setDenomination] = useState(scan.denomination ?? '')
  const [submitting, setSubmitting] = useState(false)

  const hasMissing = missing.size > 0

  const displayProducer = missing.has('producer') ? producer : (scan.producer ?? '')
  const displayDenomination = missing.has('denomination') ? denomination : (scan.denomination ?? '')
  const displayVintage = missing.has('vintage') ? vintage : (scan.vintage ? String(scan.vintage) : '')
  const displayRegion = missing.has('region') ? region : (scan.region ?? '')

  const primaryLine = [displayProducer, displayDenomination].filter(Boolean).join(' · ')
  const metaParts = [displayVintage, displayRegion, scan.quality_classification].filter(Boolean)
  const tier2Parts = [scan.vineyard, scan.cuvee, scan.grape_varieties?.join(', ')].filter(Boolean)

  const canSave = (displayProducer.trim() || displayDenomination.trim()).length > 0

  async function handleSave() {
    const edits: UpdateWineInput = {}
    if (missing.has('producer')) edits.producer = producer.trim() || null
    if (missing.has('denomination')) edits.denomination = denomination.trim() || null
    if (missing.has('vintage')) edits.vintage = vintage ? parseInt(vintage, 10) : null
    if (missing.has('region')) edits.region = region.trim() || null

    setSubmitting(true)
    await onContinue(edits)
    setSubmitting(false)
  }

  return (
    <div className="form-overlay">
      <div className="scan-result-card">

        {/* Header */}
        <div className="scan-result-header">
          <span className="scan-result-badge">Scan Result</span>
          <div className="scan-result-header-actions">
            <button className="btn-text" onClick={onRetry}>Scan Again</button>
            <button className="btn-text" onClick={onCancel}>✕</button>
          </div>
        </div>

        {/* Wine identity */}
        <div className="scan-result-identity">
          {primaryLine ? (
            <h2 className="scan-result-name">{primaryLine}</h2>
          ) : (
            <h2 className="scan-result-name scan-result-name--empty">Wine</h2>
          )}
          {metaParts.length > 0 && (
            <p className="scan-result-meta">{metaParts.join(' · ')}</p>
          )}
          {tier2Parts.map((v, i) => (
            <p key={i} className="scan-result-tier2">{v}</p>
          ))}
        </div>

        {vintageNotice && <p className="scan-missing-notice">{vintageNotice}</p>}

        {/* Inline inputs for missing Tier 1 fields */}
        {hasMissing && (
          <div className="scan-result-missing">
            <p className="scan-missing-notice">
              ⚠ Some fields couldn't be read — fill them in below
            </p>

            {missing.has('producer') && (
              <div className="scan-inline-field">
                <label>Producer</label>
                <input
                  autoFocus
                  value={producer}
                  onChange={e => setProducer(e.target.value)}
                  placeholder="e.g. Domaine Leroy"
                />
              </div>
            )}
            {missing.has('denomination') && (
              <div className="scan-inline-field">
                <label>Denomination</label>
                <input
                  value={denomination}
                  onChange={e => setDenomination(e.target.value)}
                  placeholder="e.g. Gevrey-Chambertin"
                />
              </div>
            )}
            {missing.has('vintage') && (
              <div className="scan-inline-field">
                <label>Vintage</label>
                <input
                  type="number"
                  value={vintage}
                  onChange={e => setVintage(e.target.value)}
                  placeholder="e.g. 2019"
                  min="1800"
                  max="2030"
                />
              </div>
            )}
            {missing.has('region') && (
              <div className="scan-inline-field">
                <label>Region</label>
                <input
                  value={region}
                  onChange={e => setRegion(e.target.value)}
                  placeholder="e.g. Burgundy"
                />
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="scan-result-actions">
          <button className="btn-text" onClick={onEdit}>Edit Details</button>
          <button
            className="btn-save btn-save--primary"
            onClick={handleSave}
            disabled={submitting || !canSave}
          >
            {submitting ? 'Continuing…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ScanEditForm ───────────────────────────────────────────────────────────────
// Full field-by-field edit form reached via "Edit Details".

interface EditFormProps {
  wine: WineEntry
  scan: LabelScanResult
  vintageNotice: string | null
  onContinue: (edits: UpdateWineInput) => Promise<void>
  onBack: () => void
  onCancel: () => void
}

function ScanEditForm({ wine, scan, vintageNotice, onContinue, onBack, onCancel }: EditFormProps) {
  const missing = new Set(scan.missing_tier1_fields)

  const [producer, setProducer] = useState(scan.producer ?? '')
  const [vintage, setVintage] = useState(scan.vintage ? String(scan.vintage) : '')
  const [region, setRegion] = useState(scan.region ?? '')
  const [denomination, setDenomination] = useState(scan.denomination ?? '')
  const [qualityClassification, setQualityClassification] = useState(scan.quality_classification ?? '')
  const [vineyard, setVineyard] = useState(scan.vineyard ?? '')
  const [cuvee, setCuvee] = useState(scan.cuvee ?? '')
  const [grapeVarieties, setGrapeVarieties] = useState(scan.grape_varieties?.join(', ') ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function fieldClass(key: string) {
    return missing.has(key) ? 'scan-field-missing' : ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!producer.trim() && !denomination.trim()) return
    const grapes = grapeVarieties.split(',').map(s => s.trim()).filter(Boolean)

    const edits: UpdateWineInput = {}
    const producerVal = producer.trim() || null
    const vintageVal = vintage ? parseInt(vintage, 10) : null
    const regionVal = region.trim() || null
    const denominationVal = denomination.trim() || null
    const qcVal = qualityClassification.trim() || null
    const vineyardVal = vineyard.trim() || null
    const cuveeVal = cuvee.trim() || null
    const grapesVal = grapes.length > 0 ? grapes : null

    if (producerVal !== wine.producer) edits.producer = producerVal
    if (vintageVal !== wine.vintage) edits.vintage = vintageVal
    if (regionVal !== wine.region) edits.region = regionVal
    if (denominationVal !== wine.denomination) edits.denomination = denominationVal
    if (qcVal !== wine.quality_classification) edits.quality_classification = qcVal
    if (vineyardVal !== wine.vineyard) edits.vineyard = vineyardVal
    if (cuveeVal !== wine.cuvee) edits.cuvee = cuveeVal
    if (JSON.stringify(grapesVal) !== JSON.stringify(wine.grape_varieties)) edits.grape_varieties = grapesVal

    setSubmitting(true)
    setError(null)
    try {
      await onContinue(edits)
    } catch {
      setError('Failed to save. Is the backend running?')
      setSubmitting(false)
    }
  }

  return (
    <div className="form-overlay">
      <form className="add-wine-form scan-review-form" onSubmit={handleSubmit}>
        <div className="scan-review-header">
          <button type="button" className="btn-text" onClick={onBack}>← Back</button>
          <h2>Edit Details</h2>
          {missing.size > 0 && (
            <p className="scan-missing-notice">
              ⚠️ Highlighted fields couldn't be read — please fill them in.
            </p>
          )}
          {vintageNotice && <p className="scan-missing-notice">{vintageNotice}</p>}
        </div>

        <label htmlFor="se-producer" className={fieldClass('producer')}>
          Producer {missing.has('producer') && <span className="scan-field-tag">Needs review</span>}
        </label>
        <input id="se-producer" className={fieldClass('producer')} value={producer}
          onChange={e => setProducer(e.target.value)} autoFocus={missing.has('producer')} />

        <label htmlFor="se-denomination" className={fieldClass('denomination')}>
          Denomination {missing.has('denomination') && <span className="scan-field-tag">Needs review</span>}
        </label>
        <input id="se-denomination" className={fieldClass('denomination')} value={denomination}
          onChange={e => setDenomination(e.target.value)} placeholder="e.g. Chambolle-Musigny, Barolo" />

        <label htmlFor="se-vintage" className={fieldClass('vintage')}>
          Vintage {missing.has('vintage') && <span className="scan-field-tag">Needs review</span>}
        </label>
        <input id="se-vintage" type="number" className={fieldClass('vintage')} value={vintage}
          onChange={e => setVintage(e.target.value)} placeholder="e.g. 2019" min="1800" max="2030" />

        <label htmlFor="se-region" className={fieldClass('region')}>
          Region {missing.has('region') && <span className="scan-field-tag">Needs review</span>}
        </label>
        <input id="se-region" className={fieldClass('region')} value={region}
          onChange={e => setRegion(e.target.value)} placeholder="e.g. Burgundy" />

        <label htmlFor="se-grapes">Grape Varieties <span className="scan-field-tier2">(comma-separated)</span></label>
        <input id="se-grapes" value={grapeVarieties}
          onChange={e => setGrapeVarieties(e.target.value)} placeholder="e.g. Pinot Noir" />

        <label htmlFor="se-qc">Quality Classification <span className="scan-field-tier2">(Tier 2)</span></label>
        <input id="se-qc" value={qualityClassification}
          onChange={e => setQualityClassification(e.target.value)} placeholder="e.g. Premier Cru, Riserva" />

        <label htmlFor="se-vineyard">Vineyard / Lieu-dit <span className="scan-field-tier2">(Tier 2)</span></label>
        <input id="se-vineyard" value={vineyard}
          onChange={e => setVineyard(e.target.value)} placeholder="e.g. Les Amoureuses" />

        <label htmlFor="se-cuvee">Cuvée <span className="scan-field-tier2">(Tier 2)</span></label>
        <input id="se-cuvee" value={cuvee}
          onChange={e => setCuvee(e.target.value)} placeholder="e.g. Cristal, Opus One" />

        {error && <p className="error-msg">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={onBack} disabled={submitting}>Back</button>
          <button type="button" className="btn-cancel" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn-save" disabled={submitting || (!producer.trim() && !denomination.trim())}>
            {submitting ? 'Continuing…' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}
