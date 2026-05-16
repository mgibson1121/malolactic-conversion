import type { WineEntry, WineStatus } from '@shared/types'
import { WineCard } from './WineCard'

interface Props {
  wines: WineEntry[]
  onPromote: (id: string, toStatus: WineStatus) => void
}

export function WineList({ wines, onPromote }: Props) {
  if (wines.length === 0) {
    return <p className="empty-state">No wines here yet.</p>
  }

  return (
    <ul className="wine-list">
      {wines.map((wine) => (
        <li key={wine.id}>
          <WineCard wine={wine} onPromote={onPromote} />
        </li>
      ))}
    </ul>
  )
}
