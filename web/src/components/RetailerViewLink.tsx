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
 * A retailer's "View" link (Phase 9.2, WI-6, widened 2026-08-15).
 *
 * `needsResolution` reads `is_search_results_page` — computed correctly
 * server-side for every retailer, preferred or fallback alike — rather than
 * sniffing the URL for `google.com/search`. That string check only ever
 * matched fallback (non-preferred) retailers' constructed Google searches;
 * a preferred retailer's on-site search box (K&L, Benchmark, Acker, …) never
 * matched it, so those links never got a resolve attempt at all, even though
 * the same click-to-resolve mechanism works for them too (see
 * resolveOneRetailerUrl in routes/wines.ts for the search-vs-render
 * distinction that makes this safe even for K&L, whose product-page *render*
 * is bot-blocked but whose *search* isn't).
 *
 * A retailer whose price entry is already a real product page (not a search
 * results page) is a plain link, untouched — resolution only ever fires
 * once per shop per wine, at the moment of the click.
 *
 * A blank tab opens synchronously in the click handler, so the click is never
 * blocked and never trips a popup blocker (those require a same-tick
 * `window.open`). Its destination is filled in once the real product page is
 * found or RESOLVE_TIMEOUT_MS elapses, whichever comes first — either way it
 * lands on a page that loads: the resolved product page, or the same Google
 * search the link always pointed at.
 *
 * `window.open` is called without the `noopener` flag deliberately — per
 * spec, `noopener` makes `window.open` return `null`, which is exactly the
 * handle this code needs to later set `.location.href` on. (Confirmed live,
 * not just from docs: a real click landed on a permanently stranded
 * `about:blank` tab with zero network activity, because `if (!tab) return`
 * fired before `resolveRetailerUrl` was ever called — the existing tests
 * never caught it because they mock `window.open` to always return a
 * working handle.) `tab.opener = null` gets the same reverse-tabnabbing
 * protection `noopener` would have provided, without losing the reference.
 */
export function RetailerViewLink({ wineId, retailer, onWineUpdated, className }: Props) {
  const needsResolution = retailer.is_search_results_page

  if (!needsResolution) {
    return (
      <a href={retailer.url} target="_blank" rel="noopener noreferrer" className={className}>
        View
      </a>
    )
  }

  async function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    const tab = window.open('about:blank', '_blank')
    // Popup blocked — nothing more to do; the same outcome an ordinary
    // blocked link click would have had.
    if (!tab) return
    tab.opener = null

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
