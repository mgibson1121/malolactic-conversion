/**
 * Bounded concurrency and retry for outbound API calls (2026-08-05).
 *
 * Both modules fan out with `Promise.all` — reviews over 12 retailers, each
 * up to four Serper queries, and price over its fallback retailers. For one
 * wine that is already a burst; running a batch back to back it is several
 * hundred requests with no limiter, which is precisely what the 2026-08-04
 * defect analysis predicted would break (§5, latent defect 8) and what did
 * break on the 2026-08-05 re-run: eight of fourteen wines came back with zero
 * retailers, while the same wine queried on its own returned five in two
 * seconds.
 *
 * Lives in shared/ rather than in either module because both need it and
 * modules do not import each other (CLAUDE.md §5).
 */

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let next = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })

  await Promise.all(workers)
  return results
}

/** HTTP statuses worth trying again: an explicit rate limit, or a transient
 * server-side failure. A 4xx that isn't 429 means the request was wrong and
 * will be wrong again. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

export interface RetryOptions {
  attempts?: number
  /** Base delay in ms; doubles each attempt. */
  baseDelayMs?: number
}

/**
 * Issues a request, retrying rate limits and transient server errors with
 * exponential backoff.
 *
 * Returns the final Response even when it is an error, so the caller can
 * still distinguish "rate limited after every attempt" from "the API said
 * no results" — a distinction this pipeline gets wrong at its peril, because
 * a failed fetch that reads as an empty one overwrites good stored data with
 * nothing.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  const attempts = opts.attempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 500

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)))
    }
    try {
      const res = await fetch(url, init)
      if (!isRetryable(res.status) || attempt === attempts - 1) return res
    } catch (err) {
      // Network error or timeout — retry, but remember it in case every
      // attempt fails and there is no Response to return.
      lastError = err
      if (attempt === attempts - 1) throw err
    }
  }

  // Unreachable: the loop either returns or throws on its final attempt.
  throw lastError ?? new Error('fetchWithRetry exhausted attempts')
}
