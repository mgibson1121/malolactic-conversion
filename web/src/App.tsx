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

// Icon paths read directly from the approved canvas's sidebar
// (Main.dc.html) — kept verbatim rather than re-drawn.
const NAV_ICONS: Record<TabId, JSX.Element> = {
  discovered: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M15 9l-2 5-5 2 2-5z" /></svg>
  ),
  wishlist: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4.5-6 4.5V4.5a1 1 0 0 1 1-1z" /></svg>
  ),
  cellar: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
  ),
  tasting_notes: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" /><line x1="8" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="16" y2="14" /><line x1="8" y1="18" x2="13" y2="18" /></svg>
  ),
}

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
  // Phase 11 fix — this previously called setEvaluatingWine(null) here, which
  // unmounted EvaluateForm before its own post-save setStep('tag_review') could
  // ever take effect: the tag-review prompt (Phase 4's spec) was unreachable in
  // the shipped app. EvaluateForm now owns closing itself, via its existing
  // handleTagDone → onCancel path once the tag-review step is dismissed.
  const handleEvaluateSave = async (data: CreateTastingNoteInput) => {
    await createTastingNote(data)
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
    <div className="app-shell">
      <nav className="sidebar">
        <h1 className="sidebar-brand">My Wine<br />Collection</h1>
        <div className="sidebar-nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`sidebar-nav-item${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {NAV_ICONS[tab.id]}
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="main-content">
        <header className="app-header">
          <h2>My Wine Collection</h2>
          <div className="header-actions">
            <button className="btn-scan" onClick={() => setShowScan(true)}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              Scan Label
            </button>
            <button className="btn-add" onClick={() => setShowForm(true)}>
              + Add Wine
            </button>
          </div>
        </header>

        <div className="filter-bar">
          <div className="search-input-wrap">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6.5" /><line x1="20" y1="20" x2="15.5" y2="15.5" /></svg>
            <input
              type="search"
              className="search-input"
              placeholder={`Search ${TABS.find((t) => t.id === activeTab)?.label.toLowerCase()}…`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search wines"
            />
          </div>
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
    </div>
  )
}
