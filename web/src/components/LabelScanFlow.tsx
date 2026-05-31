/**
 * LabelScanFlow.tsx
 * Full scan-to-save flow:
 *   1. File upload (drag-and-drop or click)
 *   2. Scanning state (progress indicator)
 *   3. Scan result card — visual preview of detected fields
 *      → "Edit Details" expands inline form for any adjustments
 *   4. Enriching state — wine saved, Wine-Searcher price loading
 *   5. Done — user dismisses
 */

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from 'react'
import type { CellarCategory, CreateWineInput, WineEntry } from '@shared/types'
import { fetchWinePrice, scanLabel } from '../api'
import type { LabelScanResult } from '../api'
import { PriceSection } from './PriceSection'

interface Props {
  /** Called when the user confirms a wine. Returns the created WineEntry. */
  onSave: (data: CreateWineInput) => Promise<WineEntry>
  /** Called when the user is done (after save + enriching, or on cancel). */
  onDone: () => void
}

type FlowState =
  | { step: 'upload' }
  | { step: 'scanning' }
  | { step: 'unavailable'; reason: string }
  | { step: 'review'; scan: LabelScanResult; preview: string; editing: boolean }
  | { step: 'saving'; scan: LabelScanResult; preview: string; data: CreateWineInput }
  | { step: 'enriching'; wine: WineEntry; preview: string }
  | { step: 'error'; message: string }

export function LabelScanFlow({ onSave, onDone }: Props) {
  const [flow, setFlow] = useState<FlowState>({ step: 'upload' })
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setFlow({ step: 'error', message: 'Please select an image file.' })
      return
    }

    const preview = URL.createObjectURL(file)
    setFlow({ step: 'scanning' })

    try {
      const result = await scanLabel(file)
      setFlow({ step: 'review', scan: result, preview, editing: false })
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

  // ── Saving step (brief transition) ───────────────────────────────────────────
  if (flow.step === 'saving') {
    return (
      <div className="form-overlay">
        <div className="scan-flow scan-flow--scanning">
          <span className="scan-spinner" aria-hidden="true">💾</span>
          <h2>Saving…</h2>
        </div>
      </div>
    )
  }

  // ── Enriching step ───────────────────────────────────────────────────────────
  if (flow.step === 'enriching') {
    return (
      <EnrichingCard
        wine={flow.wine}
        preview={flow.preview}
        onDone={onDone}
      />
    )
  }

  // ── Review step ──────────────────────────────────────────────────────────────
  const { scan, preview, editing } = flow

  async function handleConfirm(data: CreateWineInput) {
    setFlow({ step: 'saving', scan, preview, data })
    try {
      const wine = await onSave(data)
      setFlow({ step: 'enriching', wine, preview })
    } catch {
      setFlow({ step: 'error', message: 'Failed to save. Is the backend running?' })
    }
  }

  if (editing) {
    return (
      <ScanEditForm
        scan={scan}
        preview={preview}
        onSave={handleConfirm}
        onBack={() => setFlow({ step: 'review', scan, preview, editing: false })}
        onCancel={onDone}
      />
    )
  }

  return (
    <ScanResultCard
      scan={scan}
      preview={preview}
      onConfirm={handleConfirm}
      onEdit={() => setFlow({ step: 'review', scan, preview, editing: true })}
      onRetry={() => setFlow({ step: 'upload' })}
      onCancel={onDone}
    />
  )
}

// ── ScanResultCard ─────────────────────────────────────────────────────────────
// Visual card showing scan results. Missing Tier 1 fields get inline inputs.

interface ResultCardProps {
  scan: LabelScanResult
  preview: string
  onConfirm: (data: CreateWineInput) => Promise<void>
  onEdit: () => void
  onRetry: () => void
  onCancel: () => void
}

function ScanResultCard({ scan, preview, onConfirm, onEdit, onRetry, onCancel }: ResultCardProps) {
  const missing = new Set(scan.missing_tier1_fields)

  // Only collect inline inputs for missing Tier 1 fields
  const [producer, setProducer] = useState(scan.producer ?? '')
  const [vintage, setVintage] = useState(scan.vintage ? String(scan.vintage) : '')
  const [region, setRegion] = useState(scan.region ?? '')
  const [denomination, setDenomination] = useState(scan.denomination ?? '')
  const [cellarCategory, setCellarCategory] = useState<CellarCategory | ''>('')
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
    const grapes = scan.grape_varieties ?? null
    const data: CreateWineInput = {
      producer: displayProducer.trim() || null,
      vintage: displayVintage ? parseInt(displayVintage, 10) : null,
      region: displayRegion.trim() || null,
      denomination: displayDenomination.trim() || null,
      quality_classification: scan.quality_classification ?? null,
      vineyard: scan.vineyard ?? null,
      cuvee: scan.cuvee ?? null,
      grape_varieties: grapes,
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: false,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: cellarCategory || null,
      drinking_window: null,
      vintage_rating: null,
      my_rating: null,
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
    }
    setSubmitting(true)
    await onConfirm(data)
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

        {/* Label image */}
        <div className="scan-result-image-wrap">
          <img src={preview} alt="Scanned label" className="scan-result-image" />
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

        {/* Cellar category */}
        <div className="scan-result-cellar">
          <label htmlFor="src-cellar">Cellar category</label>
          <select
            id="src-cellar"
            value={cellarCategory}
            onChange={e => setCellarCategory(e.target.value as CellarCategory | '')}
          >
            <option value="">None</option>
            <option value="table">Table</option>
            <option value="near_term">Near Term</option>
            <option value="long_term">Long Term</option>
          </select>
        </div>

        {/* Actions */}
        <div className="scan-result-actions">
          <button className="btn-text" onClick={onEdit}>Edit Details</button>
          <button
            className="btn-save btn-save--primary"
            onClick={handleSave}
            disabled={submitting || !canSave}
          >
            {submitting ? 'Saving…' : 'Save to Collection'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── EnrichingCard ──────────────────────────────────────────────────────────────
// Shown after save. Triggers price fetch and shows result as it loads.

interface EnrichingProps {
  wine: WineEntry
  preview: string
  onDone: () => void
}

function EnrichingCard({ wine: initialWine, preview, onDone }: EnrichingProps) {
  const [wine, setWine] = useState(initialWine)
  const [priceState, setPriceState] = useState<'loading' | 'loaded' | 'unavailable'>('loading')

  useEffect(() => {
    fetchWinePrice(wine.id)
      .then(updated => {
        setWine(updated)
        setPriceState('loaded')
      })
      .catch(() => setPriceState('unavailable'))
  }, [wine.id])

  const primaryLine = [wine.producer, wine.denomination].filter(Boolean).join(' · ')
  const metaParts = [wine.vintage ? String(wine.vintage) : null, wine.region, wine.quality_classification].filter(Boolean)

  return (
    <div className="form-overlay">
      <div className="scan-result-card scan-enriching-card">

        {/* Header */}
        <div className="scan-result-header scan-result-header--saved">
          <div className="scan-saved-badge">✓ Saved to Collection</div>
        </div>

        {/* Label image */}
        <div className="scan-result-image-wrap">
          <img src={preview} alt="Wine label" className="scan-result-image" />
        </div>

        {/* Wine identity */}
        <div className="scan-result-identity">
          <h2 className="scan-result-name">{primaryLine || 'Wine'}</h2>
          {metaParts.length > 0 && <p className="scan-result-meta">{metaParts.join(' · ')}</p>}
          {wine.grape_varieties && wine.grape_varieties.length > 0 && (
            <p className="scan-result-tier2">{wine.grape_varieties.join(', ')}</p>
          )}
        </div>

        {/* Price enrichment */}
        <div className="scan-enrichment-section">
          {priceState === 'loading' && (
            <div className="scan-price-loading">
              <span className="scan-price-loading-icon">🔎</span>
              <span>Fetching prices from Wine-Searcher…</span>
            </div>
          )}

          {priceState === 'loaded' && wine.price_data && (
            <PriceSection priceData={wine.price_data} />
          )}

          {priceState === 'unavailable' && (
            <p className="scan-price-unavailable">
              Price data unavailable — check your Wine-Searcher API key or try again from the wine card.
            </p>
          )}

          {/* Drinking window from Wine-Searcher */}
          {wine.drinking_window && (
            <div className="drinking-window scan-drinking-window">
              Drink {wine.drinking_window.start} – {wine.drinking_window.end}
            </div>
          )}
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

// ── ScanEditForm ───────────────────────────────────────────────────────────────
// Full field-by-field edit form reached via "Edit Details".

interface EditFormProps {
  scan: LabelScanResult
  preview: string
  onSave: (data: CreateWineInput) => Promise<void>
  onBack: () => void
  onCancel: () => void
}

function ScanEditForm({ scan, preview, onSave, onBack, onCancel }: EditFormProps) {
  const missing = new Set(scan.missing_tier1_fields)

  const [producer, setProducer] = useState(scan.producer ?? '')
  const [vintage, setVintage] = useState(scan.vintage ? String(scan.vintage) : '')
  const [region, setRegion] = useState(scan.region ?? '')
  const [denomination, setDenomination] = useState(scan.denomination ?? '')
  const [qualityClassification, setQualityClassification] = useState(scan.quality_classification ?? '')
  const [vineyard, setVineyard] = useState(scan.vineyard ?? '')
  const [cuvee, setCuvee] = useState(scan.cuvee ?? '')
  const [grapeVarieties, setGrapeVarieties] = useState(scan.grape_varieties?.join(', ') ?? '')
  const [cellarCategory, setCellarCategory] = useState<CellarCategory | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function fieldClass(key: string) {
    return missing.has(key) ? 'scan-field-missing' : ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!producer.trim() && !denomination.trim()) return
    const grapes = grapeVarieties.split(',').map(s => s.trim()).filter(Boolean)
    const data: CreateWineInput = {
      producer: producer.trim() || null,
      vintage: vintage ? parseInt(vintage, 10) : null,
      region: region.trim() || null,
      denomination: denomination.trim() || null,
      quality_classification: qualityClassification.trim() || null,
      vineyard: vineyard.trim() || null,
      cuvee: cuvee.trim() || null,
      grape_varieties: grapes.length > 0 ? grapes : null,
      label_image_url: null,
      tag_discovered: true,
      tag_wishlist: false,
      tag_cellar: false,
      tag_consumed: false,
      cellar_quantity: 0,
      cellar_category: cellarCategory || null,
      drinking_window: null,
      vintage_rating: null,
      my_rating: null,
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_first_consumed: null,
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSave(data)
    } catch {
      setError('Failed to save. Is the backend running?')
      setSubmitting(false)
    }
  }

  return (
    <div className="form-overlay">
      <form className="add-wine-form scan-review-form" onSubmit={handleSubmit}>
        <div className="scan-review-header">
          <div>
            <button type="button" className="btn-text" onClick={onBack}>← Back</button>
            <h2>Edit Details</h2>
            {missing.size > 0 && (
              <p className="scan-missing-notice">
                ⚠️ Highlighted fields couldn't be read — please fill them in.
              </p>
            )}
          </div>
          <img src={preview} alt="Label preview" className="scan-label-preview" />
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

        <label htmlFor="se-cellar">Cellar Category</label>
        <select id="se-cellar" value={cellarCategory}
          onChange={e => setCellarCategory(e.target.value as CellarCategory | '')}>
          <option value="">None</option>
          <option value="table">Table</option>
          <option value="near_term">Near Term</option>
          <option value="long_term">Long Term</option>
        </select>

        {error && <p className="error-msg">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={onBack} disabled={submitting}>Back</button>
          <button type="button" className="btn-cancel" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn-save" disabled={submitting || (!producer.trim() && !denomination.trim())}>
            {submitting ? 'Saving…' : 'Save Wine'}
          </button>
        </div>
      </form>
    </div>
  )
}
