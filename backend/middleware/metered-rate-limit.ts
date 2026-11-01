import type { RequestHandler } from 'express'

/**
 * Per-device cap on the routes that spend metered APIs (Phase 13 WI-3).
 *
 * The real exposure behind the cloud backend is someone spending the OpenAI
 * and Serper keys (spec D9). A token can leak, so each device gets an hourly
 * and a daily ceiling on the calls that cost money; ordinary reads and edits
 * are not limited. Keyed by `res.locals.device` (set by device-auth), not by
 * IP, because a phone's address changes between Wi-Fi and cellular.
 *
 * Counts are in memory: an idle auto-stop or a deploy resets them. That is
 * acceptable — the limit bounds a leaked token's damage per running hour and
 * day, it is not a billing ledger. One machine (D4), so there is no counter
 * to share.
 */

/** Every route that reaches OpenAI, Serper or a Chromium render, with its method. */
export const METERED_ROUTES: Array<{ method: 'post'; path: string | RegExp }> = [
  { method: 'post', path: '/api/label-scan' }, // GPT-4o vision
  { method: 'post', path: '/api/tasting-notes' }, // GPT tag extraction
  // Serper + GPT-4o + renders
  { method: 'post', path: /^\/api\/wines\/[^/]+\/(fetch-price|fetch-reviews|resolve-retailer-url|confirm-retailer-link)$/ },
]

export interface MeteredLimits {
  perHour: number
  perDay: number
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/**
 * Defaults sized from the spec's usage (about 5 bottles a session, three
 * metered calls each: scan, price, reviews) with room for retries and a
 * long session. A leaked token at the daily cap spends at most about 6,000
 * Serper credits (200 × the ~29-credit worst case per fetch, about $6) plus
 * GPT-4o a day until it is revoked.
 */
export function meteredLimitsFromEnv(env = process.env): MeteredLimits {
  return {
    perHour: positiveInt(env.METERED_LIMIT_PER_HOUR, 60),
    perDay: positiveInt(env.METERED_LIMIT_PER_DAY, 200),
  }
}

export function meteredRateLimit(limits: MeteredLimits, now: () => number = Date.now): RequestHandler {
  const calls = new Map<string, number[]>()
  return (req, res, next) => {
    const key: string = res.locals.device ?? req.ip ?? 'unknown'
    const t = now()
    const recent = (calls.get(key) ?? []).filter(ts => ts > t - DAY_MS)
    const lastHour = recent.filter(ts => ts > t - HOUR_MS)

    let retryAfterMs = 0
    if (lastHour.length >= limits.perHour) retryAfterMs = lastHour[lastHour.length - limits.perHour] + HOUR_MS - t
    if (recent.length >= limits.perDay) retryAfterMs = Math.max(retryAfterMs, recent[recent.length - limits.perDay] + DAY_MS - t)

    if (retryAfterMs > 0) {
      calls.set(key, recent)
      const seconds = Math.ceil(retryAfterMs / 1000)
      console.warn(`Metered rate limit: ${key} refused ${req.method} ${req.path} (retry in ${seconds}s)`)
      res.setHeader('Retry-After', String(seconds))
      res.status(429).json({ error: 'rate_limited', retry_after_seconds: seconds })
      return
    }

    recent.push(t)
    calls.set(key, recent)
    next()
  }
}
