import type { WineEntry, WineStatus } from '@shared/types'

interface Props {
  wine: WineEntry
  onPromote: (id: string, toStatus: WineStatus) => void
}

const NEXT_STATUS: Partial<Record<WineStatus, WineStatus>> = {
  discovered: 'wishlist',
  wishlist: 'cellar',
  cellar: 'consumed',
}

const STATUS_LABELS: Record<WineStatus, string> = {
  discovered: 'Discovered',
  wishlist: 'Wishlist',
  cellar: 'Cellar',
  consumed: 'Consumed',
}

export function WineCard({ wine, onPromote }: Props) {
  const nextStatus = NEXT_STATUS[wine.status]

  // Primary identity: producer + denomination (the two canonical display fields)
  const primaryLine = [wine.producer, wine.denomination].filter(Boolean).join(' · ')
  const secondaryParts = [
    wine.vintage ? String(wine.vintage) : null,
    wine.region,
    wine.cuvee,
    wine.quality_classification,
    wine.grape_varieties && wine.grape_varieties.length > 0 ? wine.grape_varieties.join(', ') : null,
  ].filter(Boolean)

  return (
    <div className="wine-card">
      <div className="wine-name">{primaryLine || '—'}</div>
      <div className="wine-meta">
        {secondaryParts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="sep">·</span>}
            {part}
          </span>
        ))}
        <span className={`status-badge ${wine.status}`}>{STATUS_LABELS[wine.status]}</span>
      </div>
      {nextStatus && (
        <button
          className="btn-promote"
          onClick={() => onPromote(wine.id, nextStatus)}
        >
          Move to {STATUS_LABELS[nextStatus]} →
        </button>
      )}
    </div>
  )
}
