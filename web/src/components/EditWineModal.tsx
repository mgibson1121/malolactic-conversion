/**
 * EditWineModal.tsx — edit a saved wine (Phase 12.1 WI-1).
 *
 * Before this, identity fields were editable only during draft review. Now a
 * saved wine can be corrected: identity, colour, "Your price" (D12), a manual
 * drinking window (D2), list tags and bottle quantity — and deleted (WI-3).
 *
 * Saving a changed identity field on a wine that already has price or review
 * data asks "Refresh searches now?" first (D4), stating the credit cost.
 * Declining keeps the old data; the server stamps it with the identity it was
 * fetched for, and the price/review sections then say it may not match.
 * Changing colour, price, window, tags or quantity never prompts.
 */

import { useMemo, useState } from 'react'
import type { UpdateWineInput, WineColor, WineEntry } from '@shared/types'
import { HARD_REFRESH_CREDITS } from '@shared/config/enrichment-costs.config'
import { identityKey } from '@shared/utils/wine-match'
import { countNotesKeptOnDelete, deleteWine, fetchWinePrice, fetchWineReviews, updateWine } from '../api'
import { windowStatusOfWine } from '../utils/wineDerived'

interface Props {
  wine: WineEntry
  onClose: () => void
  /** The wine as saved (and, if the developer said yes, refreshed). */
  onSaved: (wine: WineEntry) => void
  onDeleted: (id: string) => void
}

const TAGS = [
  ['tag_discovered', 'Discovered'],
  ['tag_wishlist', 'Wishlist'],
  ['tag_cellar', 'Cellar'],
  ['tag_consumed', 'Consumed'],
] as const

const yearOf = (iso: string | undefined) => (iso ? iso.slice(0, 4) : '')

/** "" → null, otherwise trimmed. */
const textOrNull = (v: string) => (v.trim() === '' ? null : v.trim())

export function EditWineModal({ wine, onClose, onSaved, onDeleted }: Props) {
  const [producer, setProducer] = useState(wine.producer ?? '')
  const [denomination, setDenomination] = useState(wine.denomination ?? '')
  const [vintage, setVintage] = useState(wine.vintage != null ? String(wine.vintage) : '')
  const [region, setRegion] = useState(wine.region ?? '')
  const [classification, setClassification] = useState(wine.quality_classification ?? '')
  const [vineyard, setVineyard] = useState(wine.vineyard ?? '')
  const [cuvee, setCuvee] = useState(wine.cuvee ?? '')
  const [color, setColor] = useState<WineColor | ''>(wine.wine_color ?? '')
  const [yourPrice, setYourPrice] = useState(wine.manual_price != null ? String(wine.manual_price) : '')
  const [windowStart, setWindowStart] = useState(yearOf(wine.drinking_window?.start))
  const [windowEnd, setWindowEnd] = useState(yearOf(wine.drinking_window?.end))
  const [tags, setTags] = useState({
    tag_discovered: wine.tag_discovered,
    tag_wishlist: wine.tag_wishlist,
    tag_cellar: wine.tag_cellar,
    tag_consumed: wine.tag_consumed,
  })
  const [quantity, setQuantity] = useState(String(wine.cellar_quantity))

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState<UpdateWineInput | null>(null)
  const [deleteNotes, setDeleteNotes] = useState<number | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const derivedWindow = wine.drinking_window_source === 'derived' && wine.drinking_window != null
  const windowTouched =
    windowStart !== yearOf(wine.drinking_window?.start) || windowEnd !== yearOf(wine.drinking_window?.end)
  const status = windowStatusOfWine(wine)

  const hasEnrichment = !!(wine.price_data || (wine.review_data && wine.review_data.length > 0))

  const refreshCost = useMemo(() => {
    const typical = HARD_REFRESH_CREDITS.price.typical + HARD_REFRESH_CREDITS.reviews.typical
    const worst = HARD_REFRESH_CREDITS.price.worstCase + HARD_REFRESH_CREDITS.reviews.worstCase
    return `about ${typical} credits (up to ${worst})`
  }, [])

  /** The PATCH body, or an error message. */
  function buildPatch(): { patch: UpdateWineInput; identityChanged: boolean } | { error: string } {
    const patch: UpdateWineInput = {}
    const next = {
      producer: textOrNull(producer),
      denomination: textOrNull(denomination),
      vintage: vintage.trim() === '' ? null : Number(vintage),
      region: textOrNull(region),
      quality_classification: textOrNull(classification),
      vineyard: textOrNull(vineyard),
      cuvee: textOrNull(cuvee),
    }
    if (next.vintage !== null && (!Number.isInteger(next.vintage) || next.vintage < 1800)) {
      return { error: 'Vintage must be a four-digit year, or blank for NV.' }
    }
    for (const key of Object.keys(next) as Array<keyof typeof next>) {
      if (next[key] !== wine[key]) (patch as Record<string, unknown>)[key] = next[key]
    }
    if ((color || null) !== wine.wine_color) patch.wine_color = color || null

    // Your price: blank clears it; anything else must be positive, ≤ 2 decimals.
    const priceText = yourPrice.trim()
    if (priceText === '') {
      if (wine.manual_price != null) patch.manual_price = null
    } else {
      // Same rule as the server's ManualPriceSchema (shared/validation.ts),
      // not imported: that file pulls zod into the browser bundle.
      const value = Number(priceText.replace(/^\$/, ''))
      if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
        return { error: 'Your price must be a positive amount with at most two decimals.' }
      }
      if (value !== wine.manual_price) patch.manual_price = value
    }

    // Drinking window: only when the developer touched it. A pre-filled
    // "from critics" value that was left alone is display only — saving it
    // would turn a derived window into a manual one and silently stop future
    // automatic updates.
    if (windowTouched) {
      const s = windowStart.trim()
      const e = windowEnd.trim()
      if (s === '' && e === '') {
        patch.drinking_window = null
      } else if (/^\d{4}$/.test(s) && /^\d{4}$/.test(e) && Number(s) <= Number(e)) {
        patch.drinking_window = { start: `${s}-01-01`, end: `${e}-12-31` }
      } else {
        return { error: 'Drinking window needs a start and end year (start no later than end), or both blank.' }
      }
    }

    for (const [key] of TAGS) if (tags[key] !== wine[key]) patch[key] = tags[key]
    const qty = Number(quantity)
    if (!Number.isInteger(qty) || qty < 0) return { error: 'Bottle quantity must be a whole number, 0 or more.' }
    if (qty !== wine.cellar_quantity) patch.cellar_quantity = qty

    const identityChanged = identityKey({ ...wine, ...next }) !== identityKey(wine)
    return { patch, identityChanged }
  }

  async function save(patch: UpdateWineInput, refresh: boolean) {
    setBusy(refresh ? 'Saving, then refreshing searches…' : 'Saving…')
    setError(null)
    try {
      let saved = Object.keys(patch).length > 0 ? await updateWine(wine.id, patch) : wine
      if (refresh) {
        // Hard refresh both lookups — the developer said yes and was told the cost.
        saved = (await fetchWinePrice(saved.id, { force: true }).catch(() => saved)) as WineEntry
        saved = (await fetchWineReviews(saved.id, { force: true }).catch(() => saved)) as WineEntry
      }
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setBusy(null)
    }
  }

  function handleSave() {
    const built = buildPatch()
    if ('error' in built) {
      setError(built.error)
      return
    }
    setError(null)
    if (built.identityChanged && hasEnrichment) {
      setAsking(built.patch)
      return
    }
    void save(built.patch, false)
  }

  async function startDelete() {
    setError(null)
    try {
      setDeleteNotes(await countNotesKeptOnDelete(wine.id))
      setConfirmingDelete(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check this wine’s notes')
    }
  }

  async function confirmDelete() {
    setBusy('Deleting…')
    try {
      await deleteWine(wine.id)
      onDeleted(wine.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(null)
    }
  }

  const label = [wine.producer, wine.denomination].filter(Boolean).join(' · ')

  return (
    <div className="form-overlay">
      <div className="add-wine-form edit-wine-form" role="dialog" aria-modal="true" aria-label="Edit wine">
        <h2>Edit Wine</h2>
        <p className="evaluate-wine-label">{label}</p>

        <label htmlFor="ew-producer">Producer</label>
        <input id="ew-producer" value={producer} onChange={(e) => setProducer(e.target.value)} />

        <label htmlFor="ew-denomination">Denomination</label>
        <input id="ew-denomination" value={denomination} onChange={(e) => setDenomination(e.target.value)} />

        <label htmlFor="ew-vintage">Vintage</label>
        <input
          id="ew-vintage"
          type="number"
          value={vintage}
          onChange={(e) => setVintage(e.target.value)}
          placeholder="Leave blank for NV"
        />

        <label htmlFor="ew-region">Region</label>
        <input id="ew-region" value={region} onChange={(e) => setRegion(e.target.value)} />

        <label htmlFor="ew-classification">Quality classification</label>
        <input id="ew-classification" value={classification} onChange={(e) => setClassification(e.target.value)} />

        <label htmlFor="ew-vineyard">Vineyard / Lieu-dit</label>
        <input id="ew-vineyard" value={vineyard} onChange={(e) => setVineyard(e.target.value)} />

        <label htmlFor="ew-cuvee">Cuvée</label>
        <input id="ew-cuvee" value={cuvee} onChange={(e) => setCuvee(e.target.value)} />

        <label htmlFor="ew-color">Colour</label>
        <select id="ew-color" value={color} onChange={(e) => setColor(e.target.value as WineColor | '')}>
          <option value="">Unspecified</option>
          <option value="red">Red</option>
          <option value="white">White</option>
          <option value="rosé">Rosé</option>
        </select>

        <label htmlFor="ew-price">Your price (per 750 ml bottle)</label>
        <input
          id="ew-price"
          inputMode="decimal"
          value={yourPrice}
          onChange={(e) => setYourPrice(e.target.value)}
          placeholder="Optional — overrides the automated price"
        />
        <p className="edit-hint">
          When set, this is the price shown everywhere; the automated prices stay as reference. No search ever changes it.
        </p>

        <label>Drinking window</label>
        <div className="edit-window-row">
          <input
            aria-label="Window start year"
            inputMode="numeric"
            maxLength={4}
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            placeholder="From (year)"
          />
          <span>–</span>
          <input
            aria-label="Window end year"
            inputMode="numeric"
            maxLength={4}
            value={windowEnd}
            onChange={(e) => setWindowEnd(e.target.value)}
            placeholder="To (year)"
          />
        </div>
        {derivedWindow && !windowTouched && <p className="edit-hint">From critics. Change it to make it yours.</p>}
        {status === 'check' && !wine.drinking_window && (
          <p className="edit-hint">The critics disagree on this wine’s window — enter your own.</p>
        )}

        <label>Lists</label>
        <div className="wine-tag-controls">
          {TAGS.map(([key, name]) => (
            <button
              key={key}
              type="button"
              className={`btn-tag-toggle ${tags[key] ? 'active' : ''}`}
              aria-pressed={tags[key]}
              onClick={() => setTags((t) => ({ ...t, [key]: !t[key] }))}
            >
              {tags[key] ? '✓ ' : '+ '}
              {name}
            </button>
          ))}
        </div>

        <label htmlFor="ew-qty">Bottles in the cellar</label>
        <input id="ew-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />

        {error && <p className="error-msg">{error}</p>}

        {asking && (
          <div className="edit-refresh-prompt" role="alertdialog" aria-label="Refresh searches now?">
            <h3>Refresh searches now?</h3>
            <p>
              You changed what this wine is. Its stored prices and critic scores were found for the old version.
              Refreshing runs both searches again: {refreshCost}.
            </p>
            <div className="form-actions">
              <button type="button" className="btn-cancel" onClick={() => void save(asking, false)} disabled={!!busy}>
                Not now
              </button>
              <button type="button" className="btn-save btn-save--primary" onClick={() => void save(asking, true)} disabled={!!busy}>
                Refresh now
              </button>
            </div>
            <p className="edit-hint">“Not now” keeps the old data and marks it as possibly out of date.</p>
          </div>
        )}

        {confirmingDelete && (
          <div className="edit-delete-confirm" role="alertdialog" aria-label="Delete this wine?">
            <p>
              <strong>Delete this wine?</strong>
              {deleteNotes && deleteNotes > 0
                ? ` Its ${deleteNotes} tasting ${deleteNotes === 1 ? 'note stays' : 'notes stay'} in Notes, marked “wine removed”.`
                : ' This can’t be undone.'}
            </p>
            <div className="form-actions">
              <button type="button" className="btn-cancel" onClick={() => setConfirmingDelete(false)} disabled={!!busy}>
                Keep it
              </button>
              <button type="button" className="btn-danger" onClick={confirmDelete} disabled={!!busy}>
                Delete wine
              </button>
            </div>
          </div>
        )}

        {busy && <p className="edit-busy" role="status">{busy}</p>}

        <div className="form-actions">
          <button type="button" className="btn-danger btn-danger--quiet" onClick={startDelete} disabled={!!busy || confirmingDelete}>
            Delete wine
          </button>
          <button type="button" className="btn-cancel" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button type="button" className="btn-save" onClick={handleSave} disabled={!!busy || !!asking}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
