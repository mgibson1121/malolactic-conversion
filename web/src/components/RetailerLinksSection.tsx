import { useState } from 'react'
import type { RetailerLink, WineEntry } from '@shared/types'
import { fetchRetailerLinks, updateWine } from '../api'

interface Props {
  wine: WineEntry
  onWineUpdated: (wine: WineEntry) => void
}

/**
 * "Find Reviews" section (Phase 6.6). Generated search URLs are computed by
 * the backend on every expand — never stored. Saving a link (the search URL
 * as-is, or a specific product page URL the user navigated to) persists it
 * to `wine.retailer_links`, keyed by slug.
 */
export function RetailerLinksSection({ wine, onWineUpdated }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [links, setLinks] = useState<RetailerLink[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingSlug, setSavingSlug] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

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
                return (
                  <div key={link.slug} className="retailer-link-row">
                    <div className="retailer-link-row-main">
                      <span className="retailer-link-name">{link.name}</span>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-retailer-search"
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
