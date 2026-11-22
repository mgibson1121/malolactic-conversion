/**
 * Phase 12.1 tuning constants. One file so they can be changed without a code
 * search (WI-5).
 */

/**
 * How long the "Scan successful — pulling details" interstitial waits for a
 * first critic score before moving on to the preview anyway (D8). Measured
 * from the moment the parse returns. The lookups are not cancelled when the
 * hold ends — the preview shows its "Looking…" states for whatever is pending.
 */
export const PREVIEW_HOLD_MS = 3000

/**
 * Phase 14 WI-6: how often a running search is read while the app waits for it
 * (a free GET, never a metered call), and the longest one watcher will follow
 * a single search. Mirror `ScanTiming` in the iOS app.
 */
export const JOB_POLL_MS = 2000
export const JOB_WATCH_MAX_MS = 5 * 60 * 1000
