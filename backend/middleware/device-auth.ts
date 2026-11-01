import crypto from 'crypto'
import type { RequestHandler } from 'express'

/**
 * Per-device bearer tokens (Phase 13 WI-3, spec D9).
 *
 * A token identifies a device, not a person: there are no accounts, roles or
 * per-person data (CLAUDE.md §15 "no multi-user authentication" stands). The
 * list lives in one Fly secret, `DEVICE_TOKENS`, as comma-separated
 * `name:token` pairs — e.g. `matt-iphone:…,household-iphone:…,web:…`. Revoking
 * a device is removing its pair and re-setting the secret; the other devices
 * keep working. Names appear in logs and rate-limit keys, never the tokens.
 */
export interface DeviceToken {
  name: string
  token: string
}

/** Shortest token accepted: 32 characters (`openssl rand -hex 32` gives 64). */
export const MIN_TOKEN_LENGTH = 32

export function parseDeviceTokens(value: string | undefined): DeviceToken[] {
  const pairs = (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const tokens = pairs.map(pair => {
    const i = pair.indexOf(':')
    const name = i > 0 ? pair.slice(0, i).trim() : ''
    const token = i > 0 ? pair.slice(i + 1).trim() : ''
    // Never echo the pair itself: it holds the token.
    if (!name || !token) throw new Error('DEVICE_TOKENS: every entry must be name:token')
    if (token.length < MIN_TOKEN_LENGTH) throw new Error(`DEVICE_TOKENS: token for "${name}" is shorter than ${MIN_TOKEN_LENGTH} characters`)
    return { name, token }
  })
  const names = new Set(tokens.map(t => t.name))
  if (names.size !== tokens.length) throw new Error('DEVICE_TOKENS: device names must be unique')
  if (new Set(tokens.map(t => t.token)).size !== tokens.length) throw new Error('DEVICE_TOKENS: each device needs its own token')
  return tokens
}

const digest = (s: string) => crypto.createHash('sha256').update(s).digest()

/**
 * Rejects any request without `Authorization: Bearer <a listed token>` with
 * 401, and records the matching device's name in `res.locals.device`.
 *
 * Constant-time: both sides are hashed to equal length before
 * `timingSafeEqual`, and every listed token is compared — no early exit — so
 * response timing says nothing about how close a guess was or which entry
 * it was near.
 */
export function requireDeviceToken(tokens: DeviceToken[]): RequestHandler {
  const known = tokens.map(t => ({ name: t.name, digest: digest(t.token) }))
  return (req, res, next) => {
    const header = req.get('authorization') ?? ''
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
    let device: string | null = null
    if (match) {
      const presented = digest(match[1])
      for (const k of known) {
        if (crypto.timingSafeEqual(presented, k.digest) && device === null) device = k.name
      }
    }
    if (device === null) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    res.locals.device = device
    next()
  }
}
