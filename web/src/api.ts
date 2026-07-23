import type { CreateWineInput, CreateTastingNoteInput, RetailerLink, TastingNote, UpdateWineInput, WineEntry, WineFilter } from '@shared/types'

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

export async function fetchWinePrice(wineId: string): Promise<WineEntry> {
  return handleResponse(
    await fetch(`${BASE}/wines/${wineId}/fetch-price`, { method: 'POST' })
  )
}

export async function fetchRetailerLinks(wineId: string): Promise<RetailerLink[]> {
  return handleResponse(await fetch(`${BASE}/wines/${wineId}/retailer-links`))
}
