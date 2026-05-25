/**
 * EvaluateForm.tsx
 * WSET-structured tasting note form.
 *
 * Sections: Appearance → Nose → Palate → Conclusions
 * Aroma fields have expandable descriptor panels (info icon).
 * All enum fields use pill-style radio buttons.
 *
 * Required fields: all except Notes and Tannin.
 * Quality Assessment replaces the separate My Rating field.
 */

import { useState } from 'react'
import type {
  WineEntry,
  CreateTastingNoteInput,
  MyRating,
  TastingClarity,
  TastingColourIntensity,
  TastingNoseCondition,
  TastingIntensity,
  TastingSweetness,
  TastingAcidity,
  TastingTannin,
  TastingBody,
  TastingFinish,
  TastingQuality,
  UpdateWineInput,
} from '@shared/types'

interface Props {
  wine: WineEntry
  onSave: (data: CreateTastingNoteInput) => Promise<void>
  onTagUpdate: (id: string, tags: Partial<Pick<WineEntry, 'tag_discovered' | 'tag_wishlist' | 'tag_cellar' | 'tag_consumed'>>) => Promise<void>
  onCancel: () => void
}

// ── Aroma descriptor content (WSET Section 7) ──────────────────────────────

const PRIMARY_AROMAS: Record<string, string[]> = {
  'Red fruit':      ['raspberry', 'strawberry', 'red cherry', 'cranberry', 'redcurrant'],
  'Black fruit':    ['blackcurrant', 'blackberry', 'black cherry', 'blueberry', 'plum'],
  'Stone fruit':    ['peach', 'apricot', 'nectarine', 'cherry', 'plum'],
  'Tropical fruit': ['pineapple', 'mango', 'passion fruit', 'lychee', 'banana'],
  'Citrus fruit':   ['lemon', 'lime', 'grapefruit', 'orange zest'],
  'Floral':         ['rose', 'violet', 'jasmine', 'orange blossom', 'elderflower'],
  'Herbaceous':     ['green pepper', 'grass', 'tomato leaf', 'eucalyptus', 'mint'],
  'Spice':          ['black pepper', 'white pepper', 'liquorice'],
}

const SECONDARY_AROMAS: Record<string, string[]> = {
  'Yeast-derived':      ['bread', 'brioche', 'biscuit', 'pastry', 'cream'],
  'Malolactic':         ['butter', 'cream', 'crème fraîche', 'yoghurt'],
  'Other fermentation': ['beer', 'cider', 'cheese rind', 'nail polish'],
}

const TERTIARY_AROMAS: Record<string, string[]> = {
  'Oak-derived':        ['vanilla', 'clove', 'coconut', 'cedar', 'sandalwood', 'smoke', 'toast', 'coffee', 'chocolate'],
  'Oxidative':          ['almond', 'hazelnut', 'walnut', 'marzipan', 'toffee', 'caramel', 'dried fruit'],
  'Bottle age (red)':   ['leather', 'tobacco', 'forest floor', 'mushroom', 'truffle', 'game', 'earth', 'dried herbs'],
  'Bottle age (white)': ['petrol', 'honey', 'ginger', 'toast', 'nutty', 'waxy', 'lanolin'],
}

// ── Validation ──────────────────────────────────────────────────────────────

type FieldKey =
  | 'clarity' | 'colorIntensity' | 'color'
  | 'noseCondition' | 'noseIntensity' | 'nosePrimary' | 'noseSecondary' | 'noseTertiary'
  | 'sweetness' | 'acidity' | 'body' | 'flavourIntensity' | 'finish'
  | 'qualityAssessment'

const FIELD_LABELS: Record<FieldKey, string> = {
  clarity: 'Clarity',
  colorIntensity: 'Color Intensity',
  color: 'Color',
  noseCondition: 'Nose Condition',
  noseIntensity: 'Nose Intensity',
  nosePrimary: 'Primary Aromas',
  noseSecondary: 'Secondary Aromas',
  noseTertiary: 'Tertiary Aromas',
  sweetness: 'Sweetness',
  acidity: 'Acidity',
  body: 'Body',
  flavourIntensity: 'Flavour Intensity',
  finish: 'Finish',
  qualityAssessment: 'Quality Assessment',
}

// ── Sub-components ──────────────────────────────────────────────────────────

function RadioRow<T extends string>({
  name, options, value, onChange, labels, invalid,
}: {
  name: string
  options: readonly T[]
  value: T | ''
  onChange: (v: T) => void
  labels?: Record<string, string>
  invalid?: boolean
}) {
  return (
    <div className={`radio-row${invalid ? ' radio-row--invalid' : ''}`}>
      {options.map((opt) => (
        <label key={opt} className={`radio-opt${value === opt ? ' selected' : ''}`}>
          <input
            type="radio"
            name={name}
            value={opt}
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          {labels?.[opt] ?? opt.replace(/_/g, ' ')}
        </label>
      ))}
    </div>
  )
}

function AromaInput({
  id, value, onChange, descriptors, invalid,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  descriptors: Record<string, string[]>
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)

  function addDescriptor(term: string) {
    const current = value.split(',').map((s) => s.trim()).filter(Boolean)
    if (!current.includes(term)) onChange([...current, term].join(', '))
  }

  return (
    <div className="aroma-input-wrap">
      <div className={`aroma-input-row${invalid ? ' aroma-input-row--invalid' : ''}`}>
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. raspberry, rose, black pepper"
          className={invalid ? 'input--invalid' : ''}
        />
        <button
          type="button"
          className="aroma-info-btn"
          onClick={() => setOpen((o) => !o)}
          title="Show descriptor examples"
          aria-expanded={open}
        >
          ℹ
        </button>
      </div>
      {open && (
        <div className="aroma-descriptor-panel">
          {Object.entries(descriptors).map(([category, terms]) => (
            <div key={category} className="aroma-category">
              <span className="aroma-category-label">{category}:</span>{' '}
              {terms.map((term) => (
                <button key={term} type="button" className="aroma-chip" onClick={() => addDescriptor(term)}>
                  {term}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main form ───────────────────────────────────────────────────────────────

const TAG_LABELS: Record<string, string> = {
  tag_discovered: 'Discovered',
  tag_wishlist: 'Wishlist',
  tag_cellar: 'Cellar',
  tag_consumed: 'Consumed',
}

export function EvaluateForm({ wine, onSave, onTagUpdate, onCancel }: Props) {
  const [step, setStep] = useState<'form' | 'tag_review'>('form')
  // After save, tag_consumed is auto-set true — reflect that in local tag state
  const [tags, setTags] = useState({
    tag_discovered: wine.tag_discovered,
    tag_wishlist: wine.tag_wishlist,
    tag_cellar: wine.tag_cellar,
    tag_consumed: true,
  })
  const [tagSaving, setTagSaving] = useState(false)

  // Appearance
  const [clarity, setClarity] = useState<TastingClarity | ''>('')
  const [colorIntensity, setColorIntensity] = useState<TastingColourIntensity | ''>('')
  const [color, setColor] = useState('')

  // Nose
  const [noseCondition, setNoseCondition] = useState<TastingNoseCondition | ''>('')
  const [noseIntensity, setNoseIntensity] = useState<TastingIntensity | ''>('')
  const [nosePrimary, setNosePrimary] = useState('')
  const [noseSecondary, setNoseSecondary] = useState('')
  const [noseTertiary, setNoseTertiary] = useState('')

  // Palate
  const [sweetness, setSweetness] = useState<TastingSweetness | ''>('')
  const [acidity, setAcidity] = useState<TastingAcidity | ''>('')
  const [tannin, setTannin] = useState<TastingTannin | ''>('')
  const [body, setBody] = useState<TastingBody | ''>('')
  const [flavourIntensity, setFlavourIntensity] = useState<TastingIntensity | ''>('')
  const [finish, setFinish] = useState<TastingFinish | ''>('')

  // Conclusions
  const [qualityAssessment, setQualityAssessment] = useState<TastingQuality | ''>('')
  const [freeText, setFreeText] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const wineLabel = [wine.producer, wine.denomination, wine.vintage].filter(Boolean).join(' · ')

  // ── Validation ─────────────────────────────────────────────────────────

  function getMissingFields(): FieldKey[] {
    const missing: FieldKey[] = []
    if (!clarity)                              missing.push('clarity')
    if (!colorIntensity)                       missing.push('colorIntensity')
    if (!color.trim())                         missing.push('color')
    if (!noseCondition)                        missing.push('noseCondition')
    if (!noseIntensity)                        missing.push('noseIntensity')
    if (!nosePrimary.trim())                   missing.push('nosePrimary')
    if (!noseSecondary.trim())                 missing.push('noseSecondary')
    if (!noseTertiary.trim())                  missing.push('noseTertiary')
    if (!sweetness)                            missing.push('sweetness')
    if (!acidity)                              missing.push('acidity')
    if (!body)                                 missing.push('body')
    if (!flavourIntensity)                     missing.push('flavourIntensity')
    if (!finish)                               missing.push('finish')
    if (!qualityAssessment)                    missing.push('qualityAssessment')
    return missing
  }

  function invalid(field: FieldKey): boolean {
    return attempted && getMissingFields().includes(field)
  }

  // ── Submit ──────────────────────────────────────────────────────────────

  function parseAromas(raw: string): string[] {
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  }

  // Derive my_rating from quality_assessment (flawed → poor; others map 1:1)
  function deriveRating(qa: TastingQuality | ''): MyRating | null {
    if (!qa) return null
    if (qa === 'flawed') return 'poor'
    return qa as MyRating
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setAttempted(true)

    const missing = getMissingFields()
    if (missing.length > 0) return

    const data: CreateTastingNoteInput = {
      wine_id: wine.id,
      tasted_at: new Date().toISOString(),
      clarity: clarity || null,
      colour_intensity: colorIntensity || null,
      colour: color.trim() || null,
      nose_condition: noseCondition || null,
      nose_intensity: noseIntensity || null,
      nose_primary_aromas: parseAromas(nosePrimary),
      nose_secondary_aromas: parseAromas(noseSecondary),
      nose_tertiary_aromas: parseAromas(noseTertiary),
      palate_sweetness: sweetness || null,
      palate_acidity: acidity || null,
      palate_tannin: tannin || null,
      palate_body: body || null,
      palate_flavour_intensity: flavourIntensity || null,
      palate_finish: finish || null,
      quality_assessment: qualityAssessment || null,
      my_rating: deriveRating(qualityAssessment),
      free_text: freeText.trim() || null,
      tags: [],
    }

    setSubmitting(true)
    setSaveError(null)
    try {
      await onSave(data)
      setStep('tag_review')
    } catch {
      setSaveError('Failed to save. Is the backend running?')
      setSubmitting(false)
    }
  }

  async function handleTagDone() {
    setTagSaving(true)
    try {
      await onTagUpdate(wine.id, tags as UpdateWineInput)
    } finally {
      onCancel()
    }
  }

  // ── Option label maps ───────────────────────────────────────────────────

  const INTENSITY_LABELS: Record<string, string> = {
    light: 'Light', medium: 'Medium', medium_plus: 'Medium+', pronounced: 'Pronounced',
  }
  const ACIDITY_LABELS: Record<string, string> = {
    low: 'Low', medium_minus: 'Medium−', medium: 'Medium', medium_plus: 'Medium+', high: 'High',
  }
  const SWEETNESS_LABELS: Record<string, string> = {
    dry: 'Dry', off_dry: 'Off-dry', medium_dry: 'Medium-dry', medium: 'Medium',
    medium_sweet: 'Medium-sweet', sweet: 'Sweet', luscious: 'Luscious',
  }
  const QUALITY_LABELS: Record<string, string> = {
    flawed: 'Flawed', poor: 'Poor', acceptable: 'Acceptable',
    good: 'Good', very_good: 'Very Good', outstanding: 'Outstanding',
  }

  const missingFields = attempted ? getMissingFields() : []

  // ── Tag review step (shown after note is saved) ─────────────────────────

  if (step === 'tag_review') {
    return (
      <div className="form-overlay">
        <div className="add-wine-form tag-review-form">
          <h2>Note Saved</h2>
          <p className="tag-review-intro">
            Review your list tags for this wine. Add or remove any that apply.
          </p>
          <div className="tag-review-toggles">
            {(['tag_discovered', 'tag_wishlist', 'tag_cellar', 'tag_consumed'] as const).map((tag) => (
              <button
                key={tag}
                type="button"
                className={`btn-tag-toggle ${tags[tag] ? 'active' : ''}`}
                onClick={() => setTags((prev) => ({ ...prev, [tag]: !prev[tag] }))}
              >
                {tags[tag] ? '✓ ' : '+ '}{TAG_LABELS[tag]}
              </button>
            ))}
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn-save"
              onClick={handleTagDone}
              disabled={tagSaving}
            >
              {tagSaving ? 'Saving…' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="form-overlay">
      <form className="add-wine-form evaluate-form" onSubmit={handleSubmit}>
        <h2>Tasting Note</h2>
        <p className="evaluate-wine-label">{wineLabel}</p>

        {/* ── Appearance ── */}
        <div className="wset-section">
          <h3 className="wset-section-title">Appearance</h3>

          <label className={invalid('clarity') ? 'label--required' : ''}>
            Clarity <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="clarity"
            options={['clear', 'hazy'] as const}
            value={clarity}
            onChange={setClarity}
            invalid={invalid('clarity')}
          />

          <label className={invalid('colorIntensity') ? 'label--required' : ''}>
            Color Intensity <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="color-intensity"
            options={['pale', 'medium', 'deep'] as const}
            value={colorIntensity}
            onChange={setColorIntensity}
            invalid={invalid('colorIntensity')}
          />

          <label htmlFor="color" className={invalid('color') ? 'label--required' : ''}>
            Color <span className="req-mark">*</span>
          </label>
          <input
            id="color"
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="e.g. ruby, garnet, lemon, gold"
            className={invalid('color') ? 'input--invalid' : ''}
          />
        </div>

        {/* ── Nose ── */}
        <div className="wset-section">
          <h3 className="wset-section-title">Nose</h3>

          <label className={invalid('noseCondition') ? 'label--required' : ''}>
            Condition <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="nose-condition"
            options={['clean', 'unclean'] as const}
            value={noseCondition}
            onChange={setNoseCondition}
            invalid={invalid('noseCondition')}
          />

          <label className={invalid('noseIntensity') ? 'label--required' : ''}>
            Intensity <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="nose-intensity"
            options={['light', 'medium', 'medium_plus', 'pronounced'] as const}
            value={noseIntensity}
            onChange={setNoseIntensity}
            labels={INTENSITY_LABELS}
            invalid={invalid('noseIntensity')}
          />

          <label htmlFor="nose-primary" className={invalid('nosePrimary') ? 'label--required' : ''}>
            Primary Aromas <span className="req-mark">*</span>
            <span className="wset-hint"> — fruit, floral, herbaceous, spice</span>
          </label>
          <AromaInput
            id="nose-primary"
            value={nosePrimary}
            onChange={setNosePrimary}
            descriptors={PRIMARY_AROMAS}
            invalid={invalid('nosePrimary')}
          />

          <label htmlFor="nose-secondary" className={invalid('noseSecondary') ? 'label--required' : ''}>
            Secondary Aromas <span className="req-mark">*</span>
            <span className="wset-hint"> — fermentation-derived</span>
          </label>
          <AromaInput
            id="nose-secondary"
            value={noseSecondary}
            onChange={setNoseSecondary}
            descriptors={SECONDARY_AROMAS}
            invalid={invalid('noseSecondary')}
          />

          <label htmlFor="nose-tertiary" className={invalid('noseTertiary') ? 'label--required' : ''}>
            Tertiary Aromas <span className="req-mark">*</span>
            <span className="wset-hint"> — oak and bottle age</span>
          </label>
          <AromaInput
            id="nose-tertiary"
            value={noseTertiary}
            onChange={setNoseTertiary}
            descriptors={TERTIARY_AROMAS}
            invalid={invalid('noseTertiary')}
          />
        </div>

        {/* ── Palate ── */}
        <div className="wset-section">
          <h3 className="wset-section-title">Palate</h3>

          <label className={invalid('sweetness') ? 'label--required' : ''}>
            Sweetness <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="sweetness"
            options={['dry', 'off_dry', 'medium_dry', 'medium', 'medium_sweet', 'sweet', 'luscious'] as const}
            value={sweetness}
            onChange={setSweetness}
            labels={SWEETNESS_LABELS}
            invalid={invalid('sweetness')}
          />

          <label className={invalid('acidity') ? 'label--required' : ''}>
            Acidity <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="acidity"
            options={['low', 'medium_minus', 'medium', 'medium_plus', 'high'] as const}
            value={acidity}
            onChange={setAcidity}
            labels={ACIDITY_LABELS}
            invalid={invalid('acidity')}
          />

          <label>
            Tannin <span className="wset-hint">(reds only — optional)</span>
          </label>
          <RadioRow
            name="tannin"
            options={['low', 'medium_minus', 'medium', 'medium_plus', 'high'] as const}
            value={tannin}
            onChange={setTannin}
            labels={ACIDITY_LABELS}
          />

          <label className={invalid('body') ? 'label--required' : ''}>
            Body <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="body"
            options={['light', 'medium', 'full'] as const}
            value={body}
            onChange={setBody}
            invalid={invalid('body')}
          />

          <label className={invalid('flavourIntensity') ? 'label--required' : ''}>
            Flavour Intensity <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="flavour-intensity"
            options={['light', 'medium', 'medium_plus', 'pronounced'] as const}
            value={flavourIntensity}
            onChange={setFlavourIntensity}
            labels={INTENSITY_LABELS}
            invalid={invalid('flavourIntensity')}
          />

          <label className={invalid('finish') ? 'label--required' : ''}>
            Finish <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="finish"
            options={['short', 'medium', 'long'] as const}
            value={finish}
            onChange={setFinish}
            invalid={invalid('finish')}
          />
        </div>

        {/* ── Conclusions ── */}
        <div className="wset-section">
          <h3 className="wset-section-title">Conclusions</h3>

          <label className={invalid('qualityAssessment') ? 'label--required' : ''}>
            Quality Assessment <span className="req-mark">*</span>
          </label>
          <RadioRow
            name="quality-assessment"
            options={['flawed', 'poor', 'acceptable', 'good', 'very_good', 'outstanding'] as const}
            value={qualityAssessment}
            onChange={setQualityAssessment}
            labels={QUALITY_LABELS}
            invalid={invalid('qualityAssessment')}
          />

          <label htmlFor="free-text">Notes <span className="wset-hint">(optional)</span></label>
          <textarea
            id="free-text"
            className="evaluate-textarea"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="Open tasting notes, drinking window observations, food pairing ideas…"
            rows={4}
          />
        </div>

        {/* Validation summary */}
        {missingFields.length > 0 && (
          <p className="validation-summary">
            Please complete: {missingFields.map((f) => FIELD_LABELS[f]).join(', ')}
          </p>
        )}

        {saveError && <p className="error-msg">{saveError}</p>}

        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn-save" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Note'}
          </button>
        </div>
      </form>
    </div>
  )
}
