import type { AppSettings, CreateWineInput, CreateTastingNoteInput, RetailerLink, TastingNote, UpdateWineInput, WineEntry, WineFilter } from '@shared/types'

const BASE = '/api'

// ── Label scan ────────────────────────────────────────────────────────────────

export interface LabelScanResult {
  // Tier 1
  producer: string | null
  vintage: number | null
  region: string | null
  denomination: string | null
  // Tier 2
  quality_classification: string | null
  vineyard: string | null
  cuvee: string | null
  grape_varieties: string[] | null
  wine_color: 'red' | 'white' | 'rosé' | null
  missing_tier1_fields: string[]
  raw_response: string
}

export async function scanLabel(file: File): Promise<LabelScanResult> {
  const form = new FormData()
  form.append('label', file)
  const res = await fetch(`${BASE}/label-scan`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const code = body?.error ?? `HTTP ${res.status}`
    throw new Error(code)
  }
  return res.json() as Promise<LabelScanResult>
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ? JSON.stringify(body.error) : `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function listWines(filter?: WineFilter): Promise<WineEntry[]> {
  const params = new URLSearchParams()
  if (filter?.tag_discovered) params.set('tag_discovered', 'true')
  if (filter?.tag_wishlist) params.set('tag_wishlist', 'true')
  if (filter?.tag_cellar) params.set('tag_cellar', 'true')
  if (filter?.tag_consumed) params.set('tag_consumed', 'true')
  if (filter?.has_tasting_note) params.set('has_tasting_note', 'true')
  if (filter?.my_rating) params.set('my_rating', filter.my_rating)
  if (filter?.region) params.set('region', filter.region)
  if (filter?.q) params.set('q', filter.q)
  const qs = params.toString()
  return handleResponse(await fetch(qs ? `${BASE}/wines?${qs}` : `${BASE}/wines`))
}

export async function createWine(data: CreateWineInput): Promise<WineEntry> {
  return handleResponse(
    await fetch(`${BASE}/wines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  )
}

export async function updateWine(id: string, data: UpdateWineInput): Promise<WineEntry> {
  return handleResponse(
    await fetch(`${BASE}/wines/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  )
}

/**
 * Moves a draft into the collection (Phase 9.4, WI-2). At least one of the
 * three list tags must be true, or the server rejects with 400.
 */
export async function promoteWine(
  id: string,
  tags: { tag_discovered?: boolean; tag_wishlist?: boolean; tag_cellar?: boolean }
): Promise<WineEntry> {
  return handleResponse(
    await fetch(`${BASE}/wines/${id}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tags),
    })
  )
}

/**
 * Discards a wine (Phase 9.4, WI-7) — an explicit Discard/Cancel, or the 24h
 * draft sweep. Rejects with 409 if the wine has a tasting note.
 */
export async function deleteWine(id: string): Promise<void> {
  const res = await fetch(`${BASE}/wines/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ? String(body.error) : `HTTP ${res.status}`)
  }
}

export async function createTastingNote(data: CreateTastingNoteInput): Promise<TastingNote> {
  return handleResponse(
    await fetch(`${BASE}/tasting-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  )
}

export async function listTastingNotesByWine(wineId: string): Promise<TastingNote[]> {
  return handleResponse(await fetch(`${BASE}/tasting-notes/wine/${wineId}`))
}

/**
 * A wine returned by one of the two enrichment routes (Phase 9.2, WI-4).
 *
 * `cached` is set when the server declined to re-fetch because what it already
 * had was inside its TTL — the wine itself comes back unchanged, so a caller
 * that just wanted the data needs no special case. `fetched_at` is when that
 * stored data was actually sourced.
 */
export interface EnrichmentResponse extends WineEntry {
  cached?: boolean
  fetched_at?: string
}

export interface EnrichmentOptions {
  /** Skip the server's freshness guard and spend the credits. */
  force?: boolean
  /** Phase 9.4 (WI-3) — fetch-reviews only. 'primary' searches only the
   * primary retailer tier; omitted defaults to 'full' server-side. */
  tier?: 'primary' | 'full'
}

function enrichmentUrl(wineId: string, action: string, opts?: EnrichmentOptions): string {
  const base = `${BASE}/wines/${wineId}/${action}`
  const params = new URLSearchParams()
  if (opts?.force) params.set('force', 'true')
  if (opts?.tier) params.set('tier', opts.tier)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

export async function fetchWinePrice(
  wineId: string,
  opts?: EnrichmentOptions
): Promise<EnrichmentResponse> {
  return handleResponse(
    await fetch(enrichmentUrl(wineId, 'fetch-price', opts), { method: 'POST' })
  )
}

export async function fetchRetailerLinks(wineId: string): Promise<RetailerLink[]> {
  return handleResponse(await fetch(`${BASE}/wines/${wineId}/retailer-links`))
}

export async function fetchWineReviews(
  wineId: string,
  opts?: EnrichmentOptions
): Promise<EnrichmentResponse> {
  return handleResponse(
    await fetch(enrichmentUrl(wineId, 'fetch-reviews', opts), { method: 'POST' })
  )
}

/**
 * Resolves one fallback retailer's constructed Google search into its real
 * product page (Phase 9.2, WI-6). One credit, spent at the moment the user
 * clicks "View" on that retailer — not ahead of time for every fallback
 * retailer on every price fetch.
 */
export async function resolveRetailerUrl(wineId: string, slug: string): Promise<WineEntry> {
  return handleResponse(
    await fetch(`${BASE}/wines/${wineId}/resolve-retailer-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    })
  )
}

export async function confirmRetailerLink(wineId: string, slug: string, url: string): Promise<WineEntry> {
  return handleResponse(
    await fetch(`${BASE}/wines/${wineId}/confirm-retailer-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, url }),
    })
  )
}

// ── Settings (Phase 10.5) ────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  return handleResponse(await fetch(`${BASE}/settings`))
}

export async function updateSettings(data: Partial<AppSettings>): Promise<AppSettings> {
  return handleResponse(
    await fetch(`${BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  )
}
