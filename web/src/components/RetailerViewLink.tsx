import type { MouseEvent } from 'react'
import type { RetailerPrice, WineEntry } from '@shared/types'
import { resolveRetailerUrl } from '../api'

interface Props {
  wineId: string
  retailer: RetailerPrice
  onWineUpdated: (wine: WineEntry) => void
  className?: string
}

/**
 * How long a click on an unresolved fallback retailer waits for its real
 * product page before falling back to the constructed Google search
 * (Phase 9.2, WI-6). The user is never blocked past this — a blank tab is
 * already open and gets pointed somewhere the moment it elapses.
 */
const RESOLVE_TIMEOUT_MS = 3000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('resolve-retailer-url timed out')), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      err => { clearTimeout(timer); reject(err) }
    )
  })
}

/**
 * A retailer's "View" link (Phase 9.2, WI-6).
 *
 * Most retailers already have a real destination: a preferred retailer's own
 * on-site search, or a fallback link a previous click already resolved — both
 * are plain links, untouched. An unresolved fallback link (a constructed
 * Google search) is resolved at the moment of the click instead of ahead of
 * time for every fallback retailer on every price fetch.
 *
 * A blank tab opens synchronously in the click handler, so the click is never
 * blocked and never trips a popup blocker (those require a same-tick
 * `window.open`). Its destination is filled in once the real product page is
 * found or RESOLVE_TIMEOUT_MS elapses, whichever comes first — either way it
 * lands on a page that loads: the resolved product page, or the same Google
 * search the link always pointed at.
 */
export function RetailerViewLink({ wineId, retailer, onWineUpdated, className }: Props) {
  const needsResolution = retailer.url.includes('google.com/search')

  if (!needsResolution) {
    return (
      <a href={retailer.url} target="_blank" rel="noopener noreferrer" className={className}>
        View
      </a>
    )
  }

  async function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    const tab = window.open('about:blank', '_blank', 'noopener,noreferrer')
    // Popup blocked — nothing more to do; the same outcome an ordinary
    // blocked link click would have had.
    if (!tab) return

    const fallbackUrl = retailer.url
    try {
      const updated = await withTimeout(resolveRetailerUrl(wineId, retailer.slug), RESOLVE_TIMEOUT_MS)
      onWineUpdated(updated)
      const resolved = updated.price_data?.retailers.find(r => r.slug === retailer.slug)
      tab.location.href = resolved?.url ?? fallbackUrl
    } catch {
      tab.location.href = fallbackUrl
    }
  }

  return (
    <a
      href={retailer.url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={handleClick}
    >
      View
    </a>
  )
}
