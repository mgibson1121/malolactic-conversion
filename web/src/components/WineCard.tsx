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

  return (
    <div className="wine-card">
      <div className="wine-name">{wine.name}</div>
      <div className="wine-meta">
        {wine.producer && <span>{wine.producer}</span>}
        {wine.producer && wine.vintage && <span className="sep">·</span>}
        {wine.vintage && <span>{wine.vintage}</span>}
        {wine.region && <><span className="sep">·</span><span>{wine.region}</span></>}
        {wine.denomination && <><span className="sep">·</span><span>{wine.denomination}</span></>}
        {wine.grape_varieties.length > 0 && (
          <><span className="sep">·</span><span>{wine.grape_varieties.join(', ')}</span></>
        )}
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
