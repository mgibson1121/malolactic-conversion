import { useState, useEffect, useCallback } from 'react'
import type { WineEntry, WineStatus } from '@shared/types'
import { listWines, createWine, promoteWine } from './api'
import { WineList } from './components/WineList'
import { AddWineForm } from './components/AddWineForm'
import type { CreateWineInput } from '@shared/types'

type TabId = WineStatus | 'tasting_notes'

const TABS: { label: string; id: TabId }[] = [
  { label: 'Cellar', id: 'cellar' },
  { label: 'Wishlist', id: 'wishlist' },
  { label: 'Discovered', id: 'discovered' },
  { label: 'Consumed', id: 'consumed' },
  { label: 'Tasting Notes', id: 'tasting_notes' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('cellar')
  const [wines, setWines] = useState<WineEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const fetchWines = useCallback(async (tab: TabId) => {
    setLoading(true)
    setError(null)
    try {
      const filter =
        tab === 'tasting_notes'
          ? { has_tasting_note: true }
          : { status: tab as WineStatus }
      const data = await listWines(filter)
      setWines(data)
    } catch {
      setError('Could not load wines — is the backend running on port 3000?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWines(activeTab)
  }, [activeTab, fetchWines])

  const handlePromote = async (id: string, toStatus: WineStatus) => {
    await promoteWine(id, toStatus)
    fetchWines(activeTab)
  }

  const handleCreate = async (data: CreateWineInput) => {
    await createWine(data)
    setShowForm(false)
    const targetTab: TabId = data.status
    if (targetTab === activeTab) {
      fetchWines(activeTab)
    } else {
      setActiveTab(targetTab)
    }
  }

  const defaultFormStatus: WineStatus =
    activeTab === 'tasting_notes' ? 'cellar' : (activeTab as WineStatus)

  return (
    <div className="app">
      <header className="app-header">
        <h1>My Wine Collection</h1>
        <button className="btn-add" onClick={() => setShowForm(true)}>
          + Add Wine
        </button>
      </header>

      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {error && <p className="error-msg">{error}</p>}

      {showForm && (
        <AddWineForm
          defaultStatus={defaultFormStatus}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <p className="loading-msg">Loading…</p>
      ) : (
        <WineList wines={wines} onPromote={handlePromote} />
      )}
    </div>
  )
}
