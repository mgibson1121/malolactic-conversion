import type { CreateWineInput, WineEntry, WineStatus } from '@shared/types'

const BASE = '/api'

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
