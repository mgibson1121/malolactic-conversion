// Phase 13 WI-3 — the access key is attached to every API call, and a 401
// asks for it once.
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessKeyGate } from './AccessKeyGate'
import { apiFetch, getAccessKey, setAccessKey, clearAccessKey } from '../access-key'

const fetchMock = vi.fn()

// An in-memory localStorage: Node 25's own global localStorage (no
// --localstorage-file) shadows jsdom's and has no methods.
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  clearAccessKey()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('sends the stored key as a bearer token, keeping the caller’s headers', async () => {
    setAccessKey('k'.repeat(40))
    fetchMock.mockResolvedValue(new Response('[]'))
    await apiFetch('/api/wines', { headers: { 'Content-Type': 'application/json' } })
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe(`Bearer ${'k'.repeat(40)}`)
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('sends no Authorization header when there is no key (local backend)', async () => {
    fetchMock.mockResolvedValue(new Response('[]'))
    await apiFetch('/api/wines')
    expect((fetchMock.mock.calls[0][1].headers as Headers).has('Authorization')).toBe(false)
  })
})

describe('AccessKeyGate', () => {
  it('shows nothing until the server refuses a request', async () => {
    render(<AccessKeyGate><p>app</p></AccessKeyGate>)
    expect(screen.getByText('app')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Access key' })).not.toBeInTheDocument()

    fetchMock.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }))
    await act(() => apiFetch('/api/wines'))
    expect(screen.getByRole('form', { name: 'Access key' })).toBeInTheDocument()
    expect(screen.getByText(/only be asked once/)).toBeInTheDocument()
  })

  it('saves the typed key and reloads', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    render(<AccessKeyGate><p>app</p></AccessKeyGate>)
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    await act(() => apiFetch('/api/wines'))

    await userEvent.type(screen.getByLabelText('Access key', { selector: 'input' }), '  my-device-key  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(getAccessKey()).toBe('my-device-key')
    expect(reload).toHaveBeenCalled()
  })

  it('drops a stored key the server refused and says so', async () => {
    setAccessKey('revoked-key')
    render(<AccessKeyGate><p>app</p></AccessKeyGate>)
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    await act(() => apiFetch('/api/wines'))
    expect(getAccessKey()).toBeNull()
    expect(screen.getByText(/was not accepted/)).toBeInTheDocument()
  })
})
