import { useState, useEffect, useCallback } from 'react'
import type { WineEntry, CreateTastingNoteInput, UpdateWineInput } from '@shared/types'
import { listWines, createWine, updateWine, createTastingNote, listTastingNotesByWine } from './api'
import { WineList } from './components/WineList'
import { AddWineForm } from './components/AddWineForm'
import { LabelScanFlow } from './components/LabelScanFlow'
import { EvaluateForm } from './components/EvaluateForm'
import { TastingNoteHistory } from './components/TastingNoteHistory'
import type { CreateWineInput, TastingNote } from '@shared/types'

type TabId = 'discovered' | 'wishlist' | 'cellar' | 'tasting_notes'

const TABS: { label: string; id: TabId }[] = [
  { label: 'Discovered', id: 'discovered' },
  { label: 'Wishlist', id: 'wishlist' },
  { label: 'Cellar', id: 'cellar' },
  { label: 'Tasting Notes', id: 'tasting_notes' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('cellar')
  const [wines, setWines] = useState<WineEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const [evaluatingWine, setEvaluatingWine] = useState<WineEntry | null>(null)
  const [historyWine, setHistoryWine] = useState<WineEntry | null>(null)
  const [historyNotes, setHistoryNotes] = useState<TastingNote[]>([])

  const fetchWines = useCallback(async (tab: TabId) => {
    setLoading(true)
    setError(null)
    try {
      const filter =
        tab === 'tasting_notes'
          ? { has_tasting_note: true }
          : { [`tag_${tab}`]: true }
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

  const handleCreate = async (data: CreateWineInput) => {
    await createWine(data)
    setShowForm(false)
    setShowScan(false)
    fetchWines(activeTab)
  }

  const handleEvaluateSave = async (data: CreateTastingNoteInput) => {
    await createTastingNote(data)
    setEvaluatingWine(null)
    fetchWines(activeTab)
  }

  const handleTagUpdate = async (id: string, tags: UpdateWineInput) => {
    await updateWine(id, tags)
    fetchWines(activeTab)
  }

  const handleQuantityChange = async (id: string, delta: number) => {
    const wine = wines.find((w) => w.id === id)
    if (!wine) return
    const newQty = Math.max(0, wine.cellar_quantity + delta)
    await updateWine(id, { cellar_quantity: newQty })
    fetchWines(activeTab)
  }

  const handleViewHistory = async (wine: WineEntry) => {
    const notes = await listTastingNotesByWine(wine.id)
    setHistoryNotes(notes)
    setHistoryWine(wine)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>My Wine Collection</h1>
        <button className="btn-scan" onClick={() => setShowScan(true)}>
          📷 Scan Label
        </button>
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

      {showScan && (
        <LabelScanFlow
          onSave={handleCreate}
          onCancel={() => setShowScan(false)}
        />
      )}

      {showForm && (
        <AddWineForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {evaluatingWine && (
        <EvaluateForm
          wine={evaluatingWine}
          onSave={handleEvaluateSave}
          onTagUpdate={async (id, tags) => { await handleTagUpdate(id, tags) }}
          onCancel={() => setEvaluatingWine(null)}
        />
      )}

      {historyWine && (
        <TastingNoteHistory
          wine={historyWine}
          notes={historyNotes}
          onClose={() => setHistoryWine(null)}
        />
      )}

      {loading ? (
        <p className="loading-msg">Loading…</p>
      ) : (
        <WineList
          wines={wines}
          activeTab={activeTab}
          onEvaluate={(wine) => setEvaluatingWine(wine)}
          onTagUpdate={handleTagUpdate}
          onQuantityChange={handleQuantityChange}
          onViewHistory={handleViewHistory}
        />
      )}
    </div>
  )
}
