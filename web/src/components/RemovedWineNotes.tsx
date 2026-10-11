import { useState } from 'react'
import type { TastingNote } from '@shared/types'
import { NoteDetail, RATING_LABELS, formatDate } from './TastingNoteHistory'

/**
 * Tasting notes whose wine has been deleted (Phase 12.1 WI-3, D5). A note is a
 * record of something the developer tasted; deleting the wine must not delete
 * it. Each carries its own snapshot of the wine's identity, a "Wine removed"
 * tag, and opens read-only — no Evaluate, no price or review actions, because
 * there is no wine to act on.
 */
export function RemovedWineNotes({ notes }: { notes: TastingNote[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (notes.length === 0) return null

  return (
    <section className="removed-notes" aria-label="Notes from removed wines">
      <h3 className="removed-notes-title">From removed wines</h3>
      <ul className="note-history-list">
        {notes.map((note) => {
          const label =
            [note.wine_producer, note.wine_denomination, note.wine_vintage].filter(Boolean).join(' · ') || 'Unknown wine'
          return (
            <li key={note.id} className="note-history-item">
              <button
                type="button"
                className="note-history-header"
                aria-expanded={openId === note.id}
                onClick={() => setOpenId(openId === note.id ? null : note.id)}
              >
                <span className="removed-note-wine">{label}</span>
                <span className="pill pill-neutral wine-removed-tag">Wine removed</span>
                <span className="note-date">{formatDate(note.tasted_at)}</span>
                {note.my_rating && (
                  <span className={`rating-badge rating-${note.my_rating}`}>{RATING_LABELS[note.my_rating]}</span>
                )}
                <span className="note-expand-icon">{openId === note.id ? '▲' : '▼'}</span>
              </button>
              {openId === note.id && <NoteDetail note={note} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
