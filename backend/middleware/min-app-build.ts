import type { RequestHandler } from 'express'

/**
 * Version compatibility for the iPhone app (Phase 13 WI-8, spec R5).
 *
 * The backend deploys in minutes; phones update through TestFlight whenever
 * their owner gets to it. So API changes stay additive, and when one cannot,
 * the minimum build is raised deliberately: `MIN_IOS_BUILD` (a Fly secret or
 * env var) is the lowest `CFBundleVersion` the server still serves. Unset
 * means no check.
 *
 * The app sends its build on every request as `X-App-Build`. A request
 * without the header (the web app, curl, the smoke test) is never refused
 * here: only the iPhone app sends it, and only the iPhone app lags. A header
 * that is not a whole number cannot be shown to be new enough, so it is
 * refused like an old build.
 */
export const APP_BUILD_HEADER = 'X-App-Build'

/** Reads `MIN_IOS_BUILD`; unset or empty is no check. Anything else must be a positive integer. */
export function minIosBuildFromEnv(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  // Fail at start, not on the first request: a typo here would otherwise
  // either lock every phone out or silently turn the check off.
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
    throw new Error(`MIN_IOS_BUILD must be a positive whole number (got "${trimmed}")`)
  }
  return Number(trimmed)
}

/** `426 Upgrade Required` with `{ error: 'update_required', min_build }` for an app older than `minBuild`. */
export function requireMinAppBuild(minBuild: number): RequestHandler {
  return (req, res, next) => {
    const header = req.get(APP_BUILD_HEADER)
    if (header === undefined) return next()
    const trimmed = header.trim()
    const build = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN
    if (Number.isFinite(build) && build >= minBuild) return next()
    res.status(426).json({ error: 'update_required', min_build: minBuild })
  }
}
