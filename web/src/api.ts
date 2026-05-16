import type { CreateWineInput, WineEntry, WineStatus } from '@shared/types'

const BASE = '/api'

// ── Label scan ────────────────────────────────────────────────────────────────

export interface LabelScanResult {
  name: string | null
  producer: string | null
  vintage: number | null
  region: string | null
  denomination: string | null
  grape_varieties: string[]
  quality_classification: string | null
  vineyard: string | null
  missing_tier1_fields: string[]
  raw_response: string
}

export async function scanLabel(file: File): Promise<LabelScanResult> {
  const form = new FormData()
  form.append('label', file)
  const res = await fetch(`${BASE}/label-scan`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `HTTP ${res.status}`)
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

export async function listWines(filter?: {
  status?: WineStatus
  has_tasting_note?: boolean
}): Promise<WineEntry[]> {
  const params = new URLSearchParams()
  if (filter?.status) params.set('status', filter.status)
  if (filter?.has_tasting_note) params.set('has_tasting_note', 'true')
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

export async function promoteWine(id: string, status: WineStatus): Promise<WineEntry> {
  return handleResponse(
    await fetch(`${BASE}/wines/${id}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
  )
}
