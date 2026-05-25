import { useState } from 'react'
import type { CellarCategory, CreateWineInput } from '@shared/types'

interface Props {
  onSubmit: (data: CreateWineInput) => Promise<void>
  onCancel: () => void
}

export function AddWineForm({ onSubmit, onCancel }: Props) {
  const [producer, setProducer] = useState('')
  const [vintage, setVintage] = useState('')
  const [region, setRegion] = useState('')
  const [denomination, setDenomination] = useState('')
  const [qualityClassification, setQualityClassification] = useState('')
  const [vineyard, setVineyard] = useState('')
  const [cuvee, setCuvee] = useState('')
  const [grapeVarieties, setGrapeVarieties] = useState('')
  const [cellarCategory, setCellarCategory] = useState<CellarCategory | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!producer.trim() && !denomination.trim()) return

    const grapes = grapeVarieties.split(',').map((s) => s.trim()).filter(Boolean)
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
      await onSubmit(data)
    } catch {
      setError('Failed to save. Is the backend running?')
      setSubmitting(false)
    }
  }

  return (
    <div className="form-overlay">
      <form className="add-wine-form" onSubmit={handleSubmit}>
        <h2>Add Wine</h2>

        <label htmlFor="wf-producer">Producer *</label>
        <input
          id="wf-producer"
          value={producer}
          onChange={(e) => setProducer(e.target.value)}
          placeholder="e.g. Roumier"
          autoFocus
        />

        <label htmlFor="wf-denomination">Denomination *</label>
        <input
          id="wf-denomination"
          value={denomination}
          onChange={(e) => setDenomination(e.target.value)}
          placeholder="e.g. Chambolle-Musigny, Barolo, Rioja DOCa"
        />

        <label htmlFor="wf-vintage">Vintage</label>
        <input
          id="wf-vintage"
          type="number"
          value={vintage}
          onChange={(e) => setVintage(e.target.value)}
          placeholder="e.g. 2019 — leave blank for NV"
          min="1800"
          max="2026"
        />

        <label htmlFor="wf-region">Region</label>
        <input
          id="wf-region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="e.g. Burgundy"
        />

        <label htmlFor="wf-quality-classification">Quality Classification <span className="scan-field-tier2">(Tier 2)</span></label>
        <input
          id="wf-quality-classification"
          value={qualityClassification}
          onChange={(e) => setQualityClassification(e.target.value)}
          placeholder="e.g. Premier Cru, Grand Cru, Riserva, Gran Reserva"
        />

        <label htmlFor="wf-vineyard">Vineyard / Lieu-dit <span className="scan-field-tier2">(Tier 2)</span></label>
        <input
          id="wf-vineyard"
          value={vineyard}
          onChange={(e) => setVineyard(e.target.value)}
          placeholder="e.g. Les Amoureuses, Clos Saint-Jacques"
        />

        <label htmlFor="wf-cuvee">Cuvée <span className="scan-field-tier2">(Tier 2)</span></label>
        <input
          id="wf-cuvee"
          value={cuvee}
          onChange={(e) => setCuvee(e.target.value)}
          placeholder="e.g. Cristal, Belle Époque, Opus One"
        />

        <label htmlFor="wf-grapes">Grape Varieties <span className="scan-field-tier2">(Tier 2 — comma-separated)</span></label>
        <input
          id="wf-grapes"
          value={grapeVarieties}
          onChange={(e) => setGrapeVarieties(e.target.value)}
          placeholder="e.g. Pinot Noir"
        />

        <label htmlFor="wf-cellar-category">Cellar Category</label>
        <select
          id="wf-cellar-category"
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
          <button type="button" className="btn-cancel" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn-save" disabled={submitting || (!producer.trim() && !denomination.trim())}>
            {submitting ? 'Saving…' : 'Save Wine'}
          </button>
        </div>
      </form>
    </div>
  )
}
