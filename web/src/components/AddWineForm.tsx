import { useState } from 'react'
import type { CellarCategory, CreateWineInput, WineStatus } from '@shared/types'

interface Props {
  defaultStatus: WineStatus
  onSubmit: (data: CreateWineInput) => Promise<void>
  onCancel: () => void
}

export function AddWineForm({ defaultStatus, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('')
  const [producer, setProducer] = useState('')
  const [vintage, setVintage] = useState('')
  const [region, setRegion] = useState('')
  const [denomination, setDenomination] = useState('')
  const [grapeVarieties, setGrapeVarieties] = useState('')
  const [qualityClassification, setQualityClassification] = useState('')
  const [vineyard, setVineyard] = useState('')
  const [status, setStatus] = useState<WineStatus>(defaultStatus)
  const [cellarCategory, setCellarCategory] = useState<CellarCategory | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    const data: CreateWineInput = {
      name: name.trim(),
      producer: producer.trim() || null,
      vintage: vintage ? parseInt(vintage, 10) : null,
      region: region.trim() || null,
      denomination: denomination.trim() || null,
      grape_varieties: grapeVarieties
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      label_image_url: null,
      status,
      quality_classification: qualityClassification.trim() || null,
      vineyard: vineyard.trim() || null,
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

        <label htmlFor="wf-name">Name *</label>
        <input
          id="wf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Chambolle-Musigny 1er Cru"
          required
          autoFocus
        />

        <label htmlFor="wf-producer">Producer</label>
        <input
          id="wf-producer"
          value={producer}
          onChange={(e) => setProducer(e.target.value)}
          placeholder="e.g. Roumier"
        />

        <label htmlFor="wf-vintage">Vintage</label>
        <input
          id="wf-vintage"
          type="number"
          value={vintage}
          onChange={(e) => setVintage(e.target.value)}
          placeholder="e.g. 2019"
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

        <label htmlFor="wf-denomination">Denomination</label>
        <input
          id="wf-denomination"
          value={denomination}
          onChange={(e) => setDenomination(e.target.value)}
          placeholder="e.g. Chambolle-Musigny, Barolo, Rioja DOCa"
        />

        <label htmlFor="wf-grapes">Grape Varieties (comma-separated)</label>
        <input
          id="wf-grapes"
          value={grapeVarieties}
          onChange={(e) => setGrapeVarieties(e.target.value)}
          placeholder="e.g. Pinot Noir"
        />

        <label htmlFor="wf-quality-classification">Quality Classification (optional)</label>
        <input
          id="wf-quality-classification"
          value={qualityClassification}
          onChange={(e) => setQualityClassification(e.target.value)}
          placeholder="e.g. Premier Cru, Grand Cru, Riserva, Gran Reserva"
        />

        <label htmlFor="wf-vineyard">Vineyard / Lieu-dit (optional)</label>
        <input
          id="wf-vineyard"
          value={vineyard}
          onChange={(e) => setVineyard(e.target.value)}
          placeholder="e.g. Les Amoureuses, Clos Saint-Jacques"
        />

        <label htmlFor="wf-status">Status</label>
        <select
          id="wf-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as WineStatus)}
        >
          <option value="discovered">Discovered</option>
          <option value="wishlist">Wishlist</option>
          <option value="cellar">Cellar</option>
          <option value="consumed">Consumed</option>
        </select>

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
          <button type="submit" className="btn-save" disabled={submitting || !name.trim()}>
            {submitting ? 'Saving…' : 'Save Wine'}
          </button>
        </div>
      </form>
    </div>
  )
}
