import { useState } from 'react'
import type { TastingNote, WineEntry } from '@shared/types'

interface Props {
  wine: WineEntry
  notes: TastingNote[]
  onClose: () => void
}

const RATING_LABELS: Record<string, string> = {
  poor: 'Poor',
  acceptable: 'Acceptable',
  good: 'Good',
  very_good: 'Very Good',
  outstanding: 'Outstanding',
}

const QUALITY_LABELS: Record<string, string> = {
  flawed: 'Flawed ⚠️',
  poor: 'Poor',
  acceptable: 'Acceptable',
  good: 'Good',
  very_good: 'Very Good',
  outstanding: 'Outstanding',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function NoteDetail({ note }: { note: TastingNote }) {
  const aromas = [
    note.nose_primary_aromas.length > 0 && `Primary: ${note.nose_primary_aromas.join(', ')}`,
    note.nose_secondary_aromas.length > 0 && `Secondary: ${note.nose_secondary_aromas.join(', ')}`,
    note.nose_tertiary_aromas.length > 0 && `Tertiary: ${note.nose_tertiary_aromas.join(', ')}`,
  ].filter(Boolean)

  return (
    <div className="note-detail">
      {note.clarity && <p><strong>Appearance:</strong> {[note.clarity, note.colour_intensity, note.colour].filter(Boolean).join(', ')}</p>}
      {aromas.length > 0 && (
        <p><strong>Nose:</strong> {[note.nose_condition, note.nose_intensity].filter(Boolean).join(', ')}
          {aromas.length > 0 && <span> — {aromas.join(' · ')}</span>}
        </p>
      )}
      {note.palate_sweetness && (
        <p>
          <strong>Palate:</strong>{' '}
          {[note.palate_sweetness, note.palate_acidity && `acidity ${note.palate_acidity}`, note.palate_tannin && `tannin ${note.palate_tannin}`, note.palate_body, note.palate_finish && `finish ${note.palate_finish}`].filter(Boolean).join(', ')}
        </p>
      )}
      {note.quality_assessment && (
        <p><strong>Quality:</strong> {QUALITY_LABELS[note.quality_assessment]}</p>
      )}
      {note.free_text && <p className="note-free-text">{note.free_text}</p>}
      {note.tags.length > 0 && (
        <p className="note-tags">
          {note.tags.map((t) => <span key={t} className="note-tag-chip">{t}</span>)}
        </p>
      )}
    </div>
  )
}

export function TastingNoteHistory({ wine, notes, onClose }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(notes[0]?.id ?? null)

  const wineLabel = [wine.producer, wine.denomination, wine.vintage].filter(Boolean).join(' · ')

  return (
    <div className="form-overlay">
      <div className="add-wine-form note-history-modal">
        <h2>Tasting Notes</h2>
        <p className="evaluate-wine-label">{wineLabel}</p>

        {notes.length === 0 ? (
          <p className="empty-state">No notes recorded yet.</p>
        ) : (
          <ul className="note-history-list">
            {notes.map((note) => (
              <li key={note.id} className="note-history-item">
                <button
                  type="button"
                  className="note-history-header"
                  onClick={() => setExpandedId(expandedId === note.id ? null : note.id)}
                >
                  <span className="note-date">{formatDate(note.tasted_at)}</span>
                  {note.my_rating && (
                    <span className={`rating-badge rating-${note.my_rating}`}>
                      {RATING_LABELS[note.my_rating]}
                    </span>
                  )}
                  {note.quality_assessment === 'flawed' && (
                    <span className="fault-indicator">⚠️ Fault</span>
                  )}
                  <span className="note-expand-icon">{expandedId === note.id ? '▲' : '▼'}</span>
                </button>
                {expandedId === note.id && <NoteDetail note={note} />}
              </li>
            ))}
          </ul>
        )}

        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
