import { useState, useEffect, useCallback } from 'react'
import type { AppSettings, MyRating, WineEntry, CreateTastingNoteInput, UpdateWineInput } from '@shared/types'
import { listWines, createWine, updateWine, createTastingNote, listTastingNotesByWine, promoteWine, deleteWine, getSettings, updateSettings } from './api'
import { WineList } from './components/WineList'
import { AddWineForm } from './components/AddWineForm'
import { LabelScanFlow } from './components/LabelScanFlow'
import { DiscoveryReview } from './components/DiscoveryReview'
import { EvaluateForm } from './components/EvaluateForm'
import { TastingNoteHistory } from './components/TastingNoteHistory'
import { WineDetailModal } from './components/WineDetailModal'
import { CellarStats } from './components/CellarStats'
import type { CreateWineInput, TastingNote } from '@shared/types'

const RATING_OPTIONS: MyRating[] = ['poor', 'acceptable', 'good', 'very_good', 'outstanding']

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
  const [reviewingWine, setReviewingWine] = useState<WineEntry | null>(null)
  const [reviewingAutoFireReviews, setReviewingAutoFireReviews] = useState(false)
  // Phase 9.4, WI-4 — the promoted wines already in the collection, used
  // only for the scan flow's free duplicate check. Refreshed each time the
  // scan flow opens rather than kept continuously in sync — a few seconds
  // of staleness costs nothing here (worst case a very recent duplicate
  // slips through as "new"), and it avoids a second list subscription.
  const [existingWines, setExistingWines] = useState<WineEntry[]>([])
  // Phase 10.5 — search box (thread 76dbe89f), scoped to whatever tab is
  // active, combined with that tab's own filter (AND, not OR). Debounced so
  // every keystroke doesn't fire a request.
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])
  // Phase 10.5 — rating filter, Tasting Notes tab only. WineFilter.my_rating
  // and its route/storage wiring already existed; this is the UI control.
  const [ratingFilter, setRatingFilter] = useState<MyRating | ''>('')
  // Phase 10.5 — cellar_capacity, fetched once; the Cellar tab's stat tile
  // reads it and can update it inline.
  const [settings, setSettings] = useState<AppSettings>({ cellar_capacity: null })

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {})
  }, [])

  const fetchWines = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const baseFilter =
        activeTab === 'tasting_notes'
          ? { has_tasting_note: true, ...(ratingFilter ? { my_rating: ratingFilter } : {}) }
          : { [`tag_${activeTab}`]: true }
      const filter = debouncedQuery ? { ...baseFilter, q: debouncedQuery } : baseFilter
      const data = await listWines(filter)
      setWines(data)
    } catch (err) {
      // A response that reached the server (a non-2xx status) carries a real
      // message from handleResponse; a fetch that never got a response at
      // all throws a TypeError — that's the only case "is the backend
      // running" actually answers (gap-doc §3).
      setError(
        err instanceof TypeError || !(err instanceof Error)
          ? 'Could not load wines — is the backend running on port 3000?'
          : err.message
      )
    } finally {
      setLoading(false)
    }
  }, [activeTab, debouncedQuery, ratingFilter])

  useEffect(() => {
    fetchWines()
  }, [fetchWines])

  // Phase 9.4, WI-4 — load the duplicate-check candidate list fresh each
  // time the scan flow opens. listWines() with no filter already excludes
  // drafts by default, which is exactly "promoted wines only."
  useEffect(() => {
    if (showScan) {
      listWines().then(setExistingWines).catch(() => setExistingWines([]))
    }
  }, [showScan])

  // ── Manual add form — lands on the same Discovery Review screen as a scan ──
  // No auto-fired reviews (WI-6 is scan-only) — the draft/promote treatment
  // still applies (WI-2 covers every creation path).
  const handleFormCreate = async (data: CreateWineInput): Promise<WineEntry> => {
    const wine = await createWine(data)
    setShowForm(false)
    setReviewingAutoFireReviews(false)
    setReviewingWine(wine)
    return wine
  }

  // ── Scan flow — the draft row is created inside LabelScanFlow itself
  // (Phase 9.4, WI-1), immediately after parsing. This just receives the
  // result: either that new draft, or an existing wine the free duplicate
  // check (WI-4) matched.
  const handleScanReview = (wine: WineEntry, autoFireReviews: boolean) => {
    setShowScan(false)
    setReviewingAutoFireReviews(autoFireReviews)
    setReviewingWine(wine)
  }

  const handleReviewDone = () => {
    setReviewingWine(null)
    fetchWines()   // Ensure list reflects any changes
  }

  // Phase 9.4, WI-2/WI-7 — promote or discard the draft currently under
  // review, then close the screen.
  const handlePromote = async (
    id: string,
    tags: { tag_discovered: boolean; tag_wishlist: boolean; tag_cellar: boolean }
  ) => {
    await promoteWine(id, tags)
    setReviewingWine(null)
    fetchWines()
  }

  const handleDiscard = async (id: string) => {
    await deleteWine(id)
    setReviewingWine(null)
  }

  // ── Tasting notes ────────────────────────────────────────────────────────────
  const handleEvaluateSave = async (data: CreateTastingNoteInput) => {
    await createTastingNote(data)
    setEvaluatingWine(null)
    fetchWines()
  }

  // ── Tag + quantity ────────────────────────────────────────────────────────────
  const handleTagUpdate = async (id: string, tags: UpdateWineInput) => {
    await updateWine(id, tags)
    fetchWines()
  }

  const handleQuantityChange = async (id: string, delta: number) => {
    const wine = wines.find((w) => w.id === id)
    if (!wine) return
    const newQty = Math.max(0, wine.cellar_quantity + delta)
    await updateWine(id, { cellar_quantity: newQty })
    fetchWines()
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

      <div className="filter-bar">
        <input
          type="search"
          className="search-input"
          placeholder={`Search ${TABS.find((t) => t.id === activeTab)?.label.toLowerCase()}…`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search wines"
        />
        {activeTab === 'tasting_notes' && (
          <select
            className="rating-filter"
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value as MyRating | '')}
            aria-label="Filter by rating"
          >
            <option value="">All ratings</option>
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>{r.replace('_', ' ')}</option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="error-msg">{error}</p>}

      {activeTab === 'cellar' && !loading && (
        <CellarStats
          wines={wines}
          settings={settings}
          onCapacityChange={async (cellar_capacity) => {
            setSettings(await updateSettings({ cellar_capacity }))
          }}
        />
      )}

      {/* Scan flow */}
      {showScan && (
        <LabelScanFlow
          wines={existingWines}
          onReview={handleScanReview}
          onDone={() => setShowScan(false)}
        />
      )}

      {/* Manual add form */}
      {showForm && (
        <AddWineForm
          onSubmit={handleFormCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Discovery Review — shared post-save screen for both creation paths */}
      {reviewingWine && (
        <DiscoveryReview
          wine={reviewingWine}
          autoFireReviews={reviewingAutoFireReviews}
          onDone={handleReviewDone}
          onTagUpdate={handleTagUpdate}
          onWineUpdated={(updated) => setReviewingWine(updated)}
          onPromote={handlePromote}
          onDiscard={handleDiscard}
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
