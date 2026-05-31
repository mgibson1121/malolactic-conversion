import { useState, useEffect, useCallback } from 'react'
import type { WineEntry, CreateTastingNoteInput, UpdateWineInput } from '@shared/types'
import { listWines, createWine, updateWine, createTastingNote, listTastingNotesByWine } from './api'
import { WineList } from './components/WineList'
import { AddWineForm } from './components/AddWineForm'
import { LabelScanFlow } from './components/LabelScanFlow'
import { EvaluateForm } from './components/EvaluateForm'
import { TastingNoteHistory } from './components/TastingNoteHistory'
import { WineDetailModal } from './components/WineDetailModal'
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
  const [detailWine, setDetailWine] = useState<WineEntry | null>(null)

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

  // ── Manual add form ──────────────────────────────────────────────────────────
  const handleFormCreate = async (data: CreateWineInput) => {
    await createWine(data)
    setShowForm(false)
    fetchWines(activeTab)
  }

  // ── Scan flow — returns WineEntry so scan flow can manage enriching step ────
  const handleScanSave = async (data: CreateWineInput): Promise<WineEntry> => {
    const wine = await createWine(data)
    fetchWines(activeTab)   // Refresh list in background
    return wine
  }

  const handleScanDone = () => {
    setShowScan(false)
    fetchWines(activeTab)   // Ensure list reflects any changes
  }

  // ── Tasting notes ────────────────────────────────────────────────────────────
  const handleEvaluateSave = async (data: CreateTastingNoteInput) => {
    await createTastingNote(data)
    setEvaluatingWine(null)
    fetchWines(activeTab)
  }

  // ── Tag + quantity ────────────────────────────────────────────────────────────
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

  // ── History (legacy review history; still available from tasting notes tab) ─
  const handleViewHistory = async (wine: WineEntry) => {
    const notes = await listTastingNotesByWine(wine.id)
    setHistoryNotes(notes)
    setHistoryWine(wine)
  }

  // ── Single-wine optimistic update (from WineCard price fetch, detail modal) ─
  const handleWineUpdated = (updated: WineEntry) => {
    setWines((prev) => prev.map((w) => (w.id === updated.id ? updated : w)))
    // Keep detail modal in sync
    if (detailWine?.id === updated.id) {
      setDetailWine(updated)
    }
  }

  // ── Detail modal ─────────────────────────────────────────────────────────────
  const handleViewDetail = (wine: WineEntry) => {
    // Use the freshest copy from state if available
    const fresh = wines.find(w => w.id === wine.id) ?? wine
    setDetailWine(fresh)
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

      {/* Scan flow */}
      {showScan && (
        <LabelScanFlow
          onSave={handleScanSave}
          onDone={handleScanDone}
        />
      )}

      {/* Manual add form */}
      {showForm && (
        <AddWineForm
          onSubmit={handleFormCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Evaluate form */}
      {evaluatingWine && (
        <EvaluateForm
          wine={evaluatingWine}
          onSave={handleEvaluateSave}
          onTagUpdate={async (id, tags) => { await handleTagUpdate(id, tags) }}
          onCancel={() => setEvaluatingWine(null)}
        />
      )}

      {/* Tasting note history (legacy view) */}
      {historyWine && (
        <TastingNoteHistory
          wine={historyWine}
          notes={historyNotes}
          onClose={() => setHistoryWine(null)}
        />
      )}

      {/* Wine detail modal */}
      {detailWine && (
        <WineDetailModal
          wine={detailWine}
          onClose={() => setDetailWine(null)}
          onTagUpdate={handleTagUpdate}
          onQuantityChange={handleQuantityChange}
          onEvaluate={(wine) => setEvaluatingWine(wine)}
          onWineUpdated={handleWineUpdated}
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
          onWineUpdated={handleWineUpdated}
          onViewDetail={handleViewDetail}
        />
      )}
    </div>
  )
}
