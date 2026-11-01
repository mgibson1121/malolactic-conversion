import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { clearAccessKey, getAccessKey, onUnauthorized, setAccessKey } from '../access-key'

/**
 * Asks for the device access key when the backend refuses a request (Phase 13
 * WI-3). Renders the app underneath unchanged; the prompt appears only after
 * a 401, so a local backend without device tokens never shows it. Saving
 * reloads the page so every screen re-fetches with the key.
 */
export function AccessKeyGate({ children }: { children: ReactNode }) {
  const [asking, setAsking] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [value, setValue] = useState('')

  useEffect(
    () =>
      onUnauthorized(() => {
        // A stored key that was refused has been revoked or mistyped.
        if (getAccessKey()) {
          clearAccessKey()
          setRejected(true)
        }
        setAsking(true)
      }),
    []
  )

  function save(e: FormEvent) {
    e.preventDefault()
    const key = value.trim()
    if (!key) return
    setAccessKey(key)
    window.location.reload()
  }

  return (
    <>
      {children}
      {asking && (
        <div className="form-overlay">
          <form className="add-wine-form" onSubmit={save} aria-label="Access key">
            <h2>Access key</h2>
            <p className="access-key-hint">
              {rejected ? 'That key was not accepted. Enter this device’s access key.' : 'Enter this device’s access key. You’ll only be asked once on this browser.'}
            </p>
            <label htmlFor="access-key">Access key</label>
            <input
              id="access-key"
              type="password"
              autoComplete="off"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="form-actions">
              <button type="submit" className="btn-save" disabled={!value.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
