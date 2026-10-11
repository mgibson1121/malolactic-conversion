/**
 * The page's own link to another vintage of the same wine (Phase 12.2 D12,
 * WI-5): when the page found is a few years off, the shop usually links the
 * vintage we want from the same product family. Following that link costs one
 * local render and one extraction — **no Serper call** — where a second search
 * would cost a credit and still depend on the index.
 *
 * A link counts only when it is on the same site and its path is the current
 * page's path with only the 4-digit year changed (so `…-rabource-2023/` →
 * `…-rabource-2019/`, `/2021-vietti-barolo-147735` → `/2019-vietti-barolo-…`
 * only when the rest of the slug matches). Returns the link whose year is
 * nearest the wine's vintage and nearer than the page we already have.
 */
const YEAR = /(?<![0-9])(19|20)\d{2}(?![0-9])/g

function withoutYear(path: string): string {
  return path.replace(YEAR, '####')
}

function yearsIn(path: string): number[] {
  return [...path.matchAll(YEAR)].map(m => parseInt(m[0], 10))
}

export function nearestOtherVintageLink(html: string, pageUrl: string, wineVintage: number): string | null {
  let base: URL
  try {
    base = new URL(pageUrl)
  } catch {
    return null
  }
  const ownYears = yearsIn(decodeURIComponent(base.pathname))
  if (ownYears.length !== 1) return null // none to swap, or ambiguous which one is the vintage
  const ownGap = Math.abs(ownYears[0] - wineVintage)
  const ownShape = withoutYear(decodeURIComponent(base.pathname))

  let best: { url: string; gap: number } | null = null
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"'#]+)["']/gi)) {
    let link: URL
    try {
      link = new URL(m[1].replace(/&amp;/g, '&'), base)
    } catch {
      continue
    }
    if (link.hostname !== base.hostname) continue
    const path = decodeURIComponent(link.pathname)
    const years = yearsIn(path)
    if (years.length !== 1 || path === decodeURIComponent(base.pathname)) continue
    if (withoutYear(path) !== ownShape) continue
    const gap = Math.abs(years[0] - wineVintage)
    if (gap >= ownGap) continue
    if (!best || gap < best.gap) best = { url: `${link.origin}${link.pathname}`, gap }
  }
  return best?.url ?? null
}
