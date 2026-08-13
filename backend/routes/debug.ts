import { Router } from 'express'
import { getLifetimeUsage, resetLifetimeUsage } from '@shared/utils/serper-client'

/**
 * Local diagnostics (Phase 9.2). No auth — this is a single-user app with no
 * hosted backend (CLAUDE.md §1, §15) — and deliberately not consumed by the
 * UI: it exists so a Serper spend figure can be read off the running process
 * and checked against the Serper dashboard, not so the app can display one.
 */
const router = Router()

// GET /api/debug/serper-usage — process-lifetime Serper spend by label.
// `attempts` is the billed number; `calls` counts logical requests, and the
// two diverge exactly when fetchWithRetry is re-issuing on 429s. `avoided`
// counts calls a cost guard prevented (WI-2/3/5) — an estimate, never billed.
router.get('/serper-usage', (_req, res) => {
  res.json(getLifetimeUsage())
})

// POST /api/debug/serper-usage/reset — zero the counters, so a before/after
// measurement can be taken without restarting the server.
router.post('/serper-usage/reset', (_req, res) => {
  resetLifetimeUsage()
  res.json(getLifetimeUsage())
})

export default router
