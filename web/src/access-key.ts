/**
 * The device access key (Phase 13 WI-3). The cloud backend refuses any /api
 * call without `Authorization: Bearer <key>`; each device has its own key.
 *
 * It is never in the bundle (the repo is public, spec R8). Two places supply it:
 * - The web app served by the cloud backend: typed once into AccessKeyGate and
 *   kept in this browser's localStorage.
 * - The web app run locally with Vite against the cloud backend: vite.config.ts
 *   adds the header in the dev proxy from `WINE_ACCESS_KEY` in the repo's .env,
 *   so nothing is stored in the browser at all.
 * Against a local backend with no DEVICE_TOKENS, no key is needed.
 */

const STORAGE_KEY = 'wine.accessKey'

// localStorage can throw (private windows, blocked site data): treat that as "no key".
export function getAccessKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setAccessKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key)
  } catch {
    // Nothing to do: the next request will be refused and the prompt will reappear.
  }
}

export function clearAccessKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // As above.
  }
}

type Listener = () => void
const listeners = new Set<Listener>()

/** Subscribes to "the server refused this device"; returns the unsubscribe. */
export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `fetch` with the access key attached; a 401 tells AccessKeyGate to ask for it. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const key = getAccessKey()
  const headers = new Headers(init.headers)
  if (key) headers.set('Authorization', `Bearer ${key}`)
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401) listeners.forEach((l) => l())
  return res
}
