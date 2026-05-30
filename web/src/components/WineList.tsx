import type { WineEntry, UpdateWineInput } from '@shared/types'
import { WineCard } from './WineCard'

interface Props {
  wines: WineEntry[]
  activeTab: string
  onEvaluate: (wine: WineEntry) => void
  onTagUpdate: (id: string, tags: UpdateWineInput) => void
  onQuantityChange: (id: string, delta: number) => void
  onViewHistory: (wine: WineEntry) => void
  onWineUpdated: (wine: WineEntry) => void
}

export function WineList({ wines, activeTab, onEvaluate, onTagUpdate, onQuantityChange, onViewHistory, onWineUpdated }: Props) {
  if (wines.length === 0) {
    return <p className="empty-state">No wines here yet.</p>
  }

  return (
    <ul className="wine-list">
      {wines.map((wine) => (
        <li key={wine.id}>
          <WineCard
            wine={wine}
            activeTab={activeTab}
            onEvaluate={onEvaluate}
            onTagUpdate={onTagUpdate}
            onQuantityChange={onQuantityChange}
            onViewHistory={onViewHistory}
            onWineUpdated={onWineUpdated}
          />
        </li>
      ))}
    </ul>
  )
}
