interface Props {
  /** ISO timestamp of the stored data the server declined to re-fetch. */
  fetchedAt: string
  /** What was not re-fetched, e.g. "Reviews" or "Price". */
  label: string
}

/**
 * Shown when an enrichment click returned stored data instead of spending
 * credits (Phase 9.2, WI-4): one click to see what you have.
 *
 * Phase 12.1 (WI-7, D6): the old "Refresh anyway" link that used to sit here
 * is now the section's own bordered Hard refresh button (HardRefreshButton),
 * so this is the freshness line only.
 */
export function EnrichmentFreshness({ fetchedAt, label }: Props) {
  return (
    <span className="enrichment-freshness">
      {label} updated {formatAge(fetchedAt)}.
    </span>
  )
}

/** "3 days ago" / "today" — coarse on purpose. The question this answers is
 * "is this old enough to be worth paying to redo?", which minutes cannot
 * help with. */
export function formatAge(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'recently'

  const days = Math.floor((now.getTime() - then) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}
