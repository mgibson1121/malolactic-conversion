import { useEffect, useState } from 'react'
import type { RetailerLink, WineEntry } from '@shared/types'
import { confirmRetailerLink, fetchRetailerLinks, updateWine } from '../api'

interface Props {
  wine: WineEntry
  onWineUpdated: (wine: WineEntry) => void
  // Enables the guided clipboard-confirmation flow (Phase 7.2) — opt-in
  // since it installs a document visibilitychange listener per instance;
  // the wine detail view (one instance visible at a time) enables it, the
  // card list (many instances at once) doesn't.
  guided?: boolean
}

interface PendingSearch {
  slug: string
  name: string
  hostname: string
}

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./, '')
}

function hostnameMatches(a: string, b: string): boolean {
  const sa = stripWww(a)
  const sb = stripWww(b)
  return sa.includes(sb) || sb.includes(sa)
}

/**
 * "Find Reviews" section (Phase 6.6). Generated search URLs are computed by
 * the backend on every expand — never stored. Saving a link (the search URL
 * as-is, or a specific product page URL the user navigated to) persists it
 * to `wine.retailer_links`, keyed by slug.
 *
 * Guided mode (Phase 7.2): after clicking Search, switching back to this
 * tab checks the clipboard for a URL on the retailer's domain and offers to
 * save + immediately extract from it — a fallback for wines where automated
 * review sourcing (Phase 7) found nothing and the developer wants to check
 * a trusted retailer directly, rather than a parallel path that could
 * second-guess an automated result that already succeeded.
 */
export function RetailerLinksSection({ wine, onWineUpdated, guided = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [links, setLinks] = useState<RetailerLink[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingSlug, setSavingSlug] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Guided-confirmation state
  const [pendingSearch, setPendingSearch] = useState<PendingSearch | null>(null)
  const [confirmValue, setConfirmValue] = useState('')
  const [confirmMatched, setConfirmMatched] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  useEffect(() => {
    if (!guided || !pendingSearch) return

    async function checkClipboard() {
      if (document.visibilityState !== 'visible') return
      let clipboardText = ''
      try {
        clipboardText = await navigator.clipboard.readText()
      } catch {
        // Permission denied or unsupported — fall through to manual paste,
        // no error surfaced (this is an expected, common outcome).
      }
      let matched = false
      let prefill = ''
      try {
        const url = new URL(clipboardText)
        if (pendingSearch && hostnameMatches(url.hostname, pendingSearch.hostname)) {
          matched = true
          prefill = clipboardText
        }
      } catch {
        // Clipboard didn't contain a valid URL — leave prefill empty.
      }
      setConfirmMatched(matched)
      setConfirmValue(prefill)
    }

    document.addEventListener('visibilitychange', checkClipboard)
    // Also cover the case where the tab is already visible again by the
    // time this effect runs (e.g. a fast alt-tab back).
    checkClipboard()
    return () => document.removeEventListener('visibilitychange', checkClipboard)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided, pendingSearch])

  async function handleExpand() {
    const next = !expanded
    setExpanded(next)
    if (next && links === null && !loading) {
      setLoading(true)
      setLoadError(null)
      try {
        setLinks(await fetchRetailerLinks(wine.id))
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Could not generate retailer links')
      } finally {
        setLoading(false)
      }
    }
  }

  function handleSearchClick(link: RetailerLink) {
    if (!guided) return
    setConfirmError(null)
    setConfirmMatched(false)
    setConfirmValue('')
    try {
      setPendingSearch({ slug: link.slug, name: link.name, hostname: new URL(link.url).hostname })
    } catch {
      setPendingSearch(null)
    }
    // Anchor's default behavior (open in new tab) proceeds unchanged.
  }

  function dismissPending() {
    setPendingSearch(null)
    setConfirmValue('')
    setConfirmMatched(false)
    setConfirmError(null)
  }

  async function handleConfirmSave() {
    if (!pendingSearch || !confirmValue.trim()) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const updated = await confirmRetailerLink(wine.id, pendingSearch.slug, confirmValue.trim())
      onWineUpdated(updated)
      dismissPending()
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Could not save and extract from that link')
    } finally {
      setConfirming(false)
    }
  }

  function startEditing(slug: string, defaultUrl: string) {
    setEditingSlug(slug)
    setEditValue(wine.retailer_links?.[slug] ?? defaultUrl)
    setSaveError(null)
  }

  async function handleSave(slug: string) {
    setSavingSlug(slug)
    setSaveError(null)
    try {
      const merged = { ...(wine.retailer_links ?? {}), [slug]: editValue }
      const updated = await updateWine(wine.id, { retailer_links: merged })
      onWineUpdated(updated)
      setEditingSlug(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingSlug(null)
    }
  }

  async function handleClear(slug: string) {
    setSavingSlug(slug)
    setSaveError(null)
    try {
      const merged = { ...(wine.retailer_links ?? {}) }
      delete merged[slug]
      const updated = await updateWine(wine.id, { retailer_links: merged })
      onWineUpdated(updated)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not remove saved link')
    } finally {
      setSavingSlug(null)
    }
  }

  return (
    <div className="retailer-links-section">
      <button className="btn-find-reviews" onClick={handleExpand}>
        {expanded ? 'Hide Retailers' : 'Search Retailers'}
      </button>

      {expanded && (
        <div className="retailer-links-body">
          {loading && <p className="detail-loading">Generating search links…</p>}
          {loadError && <p className="price-error">{loadError}</p>}

          {links && links.length === 0 && (
            <p className="detail-empty-hint">Need a producer or denomination to search for reviews.</p>
          )}

          {links && links.length > 0 && (
            <div className="retailer-link-list">
              {links.map((link) => {
                const saved = wine.retailer_links?.[link.slug]
                const isEditing = editingSlug === link.slug
                const reviewResult = wine.review_data?.find((r) => r.slug === link.slug)
                const hasScores = (reviewResult?.critic_scores.length ?? 0) > 0
                const isPending = pendingSearch?.slug === link.slug
                return (
                  <div key={link.slug} className="retailer-link-row">
                    <div className="retailer-link-row-main">
                      <span className="retailer-link-name">{link.name}</span>
                      {hasScores && (
                        <span className="retailer-scores-found" title="Automated review sourcing already found scores here">
                          ✓ {reviewResult!.critic_scores.length} score{reviewResult!.critic_scores.length !== 1 ? 's' : ''} found
                        </span>
                      )}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={hasScores ? 'btn-retailer-search btn-retailer-search--secondary' : 'btn-retailer-search'}
                        onClick={() => handleSearchClick(link)}
                      >
                        Search
                      </a>
                      {saved && !isEditing && (
                        <a
                          href={saved}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="retailer-link-saved"
                          title="Saved link"
                        >
                          ✓ Saved
                        </a>
                      )}
                      {!isEditing && (
                        <button
                          className="btn-retailer-link-edit"
                          onClick={() => startEditing(link.slug, link.url)}
                        >
                          {saved ? 'Edit' : 'Save link'}
                        </button>
                      )}
                      {saved && !isEditing && (
                        <button
                          className="btn-retailer-link-clear"
                          onClick={() => handleClear(link.slug)}
                          disabled={savingSlug === link.slug}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {isEditing && (
                      <div className="retailer-link-edit-row">
                        <input
                          type="url"
                          className="retailer-link-input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder="Paste the review or product page URL"
                        />
                        <button
                          className="btn-retailer-link-save"
                          onClick={() => handleSave(link.slug)}
                          disabled={savingSlug === link.slug || !editValue.trim()}
                        >
                          {savingSlug === link.slug ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="btn-retailer-link-cancel"
                          onClick={() => setEditingSlug(null)}
                          disabled={savingSlug === link.slug}
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    {guided && isPending && (
                      <div className="retailer-confirm-row">
                        <p className="retailer-confirm-hint">
                          {confirmMatched
                            ? `Found a ${pendingSearch!.name} link on your clipboard — save it for this wine?`
                            : `Paste the ${pendingSearch!.name} product page URL you found:`}
                        </p>
                        <div className="retailer-link-edit-row">
                          <input
                            type="url"
                            className="retailer-link-input"
                            value={confirmValue}
                            onChange={(e) => setConfirmValue(e.target.value)}
                            placeholder="Paste the product page URL"
                          />
                          <button
                            className="btn-retailer-link-save"
                            onClick={handleConfirmSave}
                            disabled={confirming || !confirmValue.trim()}
                          >
                            {confirming ? 'Saving & extracting…' : 'Save & Extract'}
                          </button>
                          <button
                            className="btn-retailer-link-cancel"
                            onClick={dismissPending}
                            disabled={confirming}
                          >
                            Dismiss
                          </button>
                        </div>
                        {confirmError && <p className="price-error">{confirmError}</p>}
                      </div>
                    )}
                  </div>
                )
              })}
              {saveError && <p className="price-error">{saveError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
