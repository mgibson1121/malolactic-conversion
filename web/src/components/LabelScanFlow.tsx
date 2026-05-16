/**
 * LabelScanFlow.tsx
 * Full scan-to-save flow:
 *   1. File upload (drag-and-drop or click)
 *   2. Scanning state (progress indicator)
 *   3. Review card — pre-populated from scan, missing Tier 1 fields highlighted
 *   4. Confirm/edit → save to Sheets
 */

import { useState, useRef, DragEvent, ChangeEvent } from 'react'
import type { CellarCategory, CreateWineInput, WineStatus } from '@shared/types'
import { scanLabel } from '../api'
import type { LabelScanResult } from '../api'

interface Props {
  defaultStatus: WineStatus
  onSave: (data: CreateWineInput) => Promise<void>
  onCancel: () => void
}

type FlowState =
  | { step: 'upload' }
  | { step: 'scanning' }
  | { step: 'unavailable'; reason: string }
  | { step: 'review'; scan: LabelScanResult; preview: string }
  | { step: 'error'; message: string }

const TIER1_LABELS: Record<string, string> = {
  name: 'Name',
  producer: 'Producer',
  vintage: 'Vintage',
  region: 'Region',
  denomination: 'Denomination',
}

export function LabelScanFlow({ defaultStatus, onSave, onCancel }: Props) {
  const [flow, setFlow] = useState<FlowState>({ step: 'upload' })
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── File handling ─────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setFlow({ step: 'error', message: 'Please select an image file.' })
      return
    }

    const preview = URL.createObjectURL(file)
    setFlow({ step: 'scanning' })

    try {
      const result = await scanLabel(file)
      setFlow({ step: 'review', scan: result, preview })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('openai_api_key') || msg.toLowerCase().includes('unavailable')) {
        setFlow({
          step: 'unavailable',
          reason: 'Label scanning is unavailable — OPENAI_API_KEY is not configured on the backend.',
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

  // ── Render states ─────────────────────────────────────────────────────────

  if (flow.step === 'upload') {
    return (
      <div className="form-overlay">
        <div className="scan-flow">
          <h2>Scan Wine Label</h2>
          <p className="scan-subtitle">
            Upload a photo of the bottle label — GPT-4o will extract the details for you.
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
            <button className="btn-cancel" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

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

  if (flow.step === 'unavailable') {
    return (
      <div className="form-overlay">
        <div className="scan-flow">
          <h2>Scan Unavailable</h2>
          <p className="error-msg">{flow.reason}</p>
          <p>You can still add wines manually using the <strong>+ Add Wine</strong> button.</p>
          <div className="form-actions">
            <button className="btn-cancel" onClick={onCancel}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  if (flow.step === 'error') {
    return (
      <div className="form-overlay">
        <div className="scan-flow">
          <h2>Scan Failed</h2>
          <p className="error-msg">{flow.message}</p>
          <div className="form-actions">
            <button className="btn-cancel" onClick={() => setFlow({ step: 'upload' })}>Try Again</button>
            <button className="btn-cancel" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Review card ────────────────────────────────────────────────────────────

  const { scan, preview } = flow

  return (
    <ScanReviewForm
      scan={scan}
      preview={preview}
      defaultStatus={defaultStatus}
      onSave={onSave}
      onRetry={() => setFlow({ step: 'upload' })}
      onCancel={onCancel}
    />
  )
}

// ── ScanReviewForm ─────────────────────────────────────────────────────────────

interface ReviewProps {
  scan: LabelScanResult
  preview: string
  defaultStatus: WineStatus
  onSave: (data: CreateWineInput) => Promise<void>
  onRetry: () => void
  onCancel: () => void
}

function ScanReviewForm({ scan, preview, defaultStatus, onSave, onRetry, onCancel }: ReviewProps) {
  const missing = new Set(scan.missing_tier1_fields)

  const [name, setName] = useState(scan.name ?? '')
  const [producer, setProducer] = useState(scan.producer ?? '')
  const [vintage, setVintage] = useState(scan.vintage ? String(scan.vintage) : '')
  const [region, setRegion] = useState(scan.region ?? '')
  const [denomination, setDenomination] = useState(scan.denomination ?? '')
  const [grapeVarieties, setGrapeVarieties] = useState(scan.grape_varieties.join(', '))
  const [qualityClassification, setQualityClassification] = useState(scan.quality_classification ?? '')
  const [vineyard, setVineyard] = useState(scan.vineyard ?? '')
  const [status, setStatus] = useState<WineStatus>(defaultStatus)
  const [cellarCategory, setCellarCategory] = useState<CellarCategory | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasMissing = missing.size > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    const data: CreateWineInput = {
      name: name.trim(),
      producer: producer.trim() || null,
      vintage: vintage ? parseInt(vintage, 10) : null,
      region: region.trim() || null,
      denomination: denomination.trim() || null,
      grape_varieties: grapeVarieties.split(',').map((s) => s.trim()).filter(Boolean),
      quality_classification: qualityClassification.trim() || null,
      vineyard: vineyard.trim() || null,
      label_image_url: null,
      status,
      cellar_category: cellarCategory || null,
      drinking_window: null,
      vintage_rating: null,
      my_rating: null,
      my_tags: [],
      wishlist_notes: null,
      price_paid: null,
      purchased_from: null,
      date_consumed: null,
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

  function fieldClass(fieldKey: string) {
    return missing.has(fieldKey) ? 'scan-field-missing' : ''
  }

  return (
    <div className="form-overlay">
      <form className="add-wine-form scan-review-form" onSubmit={handleSubmit}>
        <div className="scan-review-header">
          <div>
            <h2>Review Scan Result</h2>
            {hasMissing && (
              <p className="scan-missing-notice">
                ⚠️ The scan couldn't read some fields — they're highlighted below. Please fill them in before saving.
              </p>
            )}
          </div>
          <img src={preview} alt="Label preview" className="scan-label-preview" />
        </div>

        {/* Tier 1 fields */}
        <label htmlFor="sr-name" className={fieldClass('name')}>
          Name * {missing.has('name') && <span className="scan-field-tag">Needs review</span>}
        </label>
        <input
          id="sr-name"
          className={fieldClass('name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={missing.has('name') ? TIER1_LABELS['name'] + ' — enter manually' : ''}
          required
          autoFocus={missing.has('name')}
        />

        <label htmlFor="sr-producer" className={fieldClass('producer')}>
          Producer {missing.has('producer') && <span className="scan-field-tag">Needs review</span>}
        </label>
        <input
          id="sr-producer"
          className={fieldClass('producer')}
          value={producer}
          onChange={(e) => setProducer(e.target.value)}
          placeholder={missing.has('producer') ? 'Enter producer name manually' : ''}
        />

        <label htmlFor="sr-vintage" className={fieldClass('vintage')}>
          Vintage {missing.has('vintage') && <span className="scan-field-tag">Needs review</span>}
        </label>
        <input
          id="sr-vintage"
          type="number"
          className={fieldClass('vintage')}
          value={vintage}
          onChange={(e) => setVintage(e.target.value)}
          placeholder={missing.has('vintage') ? 'e.g. 2019' : ''}
          min="1800"
          max="2026"
        />

        <label htmlFor="sr-region" className={fieldClass('region')}>
          Region {missing.has('region') && <span className="scan-field-tag">Needs review</span>}
        </label>
        <input
          id="sr-region"
          className={fieldClass('region')}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder={missing.has('region') ? 'e.g. Burgundy' : ''}
        />

        <label htmlFor="sr-denomination" className={fieldClass('denomination')}>
          Denomination {missing.has('denomination') && <span className="scan-field-tag">Needs review</span>}
        </label>
        <input
          id="sr-denomination"
          className={fieldClass('denomination')}
          value={denomination}
          onChange={(e) => setDenomination(e.target.value)}
          placeholder={missing.has('denomination') ? 'e.g. Chambolle-Musigny, Barolo' : ''}
        />

        <label htmlFor="sr-grapes">Grape Varieties (comma-separated)</label>
        <input
          id="sr-grapes"
          value={grapeVarieties}
          onChange={(e) => setGrapeVarieties(e.target.value)}
          placeholder="e.g. Pinot Noir"
        />

        {/* Tier 2 fields — no warning, null is valid */}
        <label htmlFor="sr-quality-classification">
          Quality Classification <span className="scan-field-tier2">(Tier 2 — optional)</span>
        </label>
        <input
          id="sr-quality-classification"
          value={qualityClassification}
          onChange={(e) => setQualityClassification(e.target.value)}
          placeholder="e.g. Premier Cru, Grand Cru, Riserva"
        />

        <label htmlFor="sr-vineyard">
          Vineyard / Lieu-dit <span className="scan-field-tier2">(Tier 2 — optional)</span>
        </label>
        <input
          id="sr-vineyard"
          value={vineyard}
          onChange={(e) => setVineyard(e.target.value)}
          placeholder="e.g. Les Amoureuses, Vigna Francia"
        />

        <label htmlFor="sr-status">Status</label>
        <select
          id="sr-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as WineStatus)}
        >
          <option value="discovered">Discovered</option>
          <option value="wishlist">Wishlist</option>
          <option value="cellar">Cellar</option>
          <option value="consumed">Consumed</option>
        </select>

        <label htmlFor="sr-cellar-category">Cellar Category</label>
        <select
          id="sr-cellar-category"
          value={cellarCategory}
          onChange={(e) => setCellarCategory(e.target.value as CellarCategory | '')}
        >
          <option value="">None</option>
          <option value="table">Table</option>
          <option value="near_term">Near Term</option>
          <option value="long_term">Long Term</option>
        </select>

        {error && <p className="error-msg">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={onRetry} disabled={submitting}>
            Scan Again
          </button>
          <button type="button" className="btn-cancel" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn-save" disabled={submitting || !name.trim()}>
            {submitting ? 'Saving…' : 'Save Wine'}
          </button>
        </div>
      </form>
    </div>
  )
}
