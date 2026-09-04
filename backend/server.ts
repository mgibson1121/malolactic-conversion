import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(__dirname, '../.env') })
import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import winesRouter from './routes/wines'
import tastingNotesRouter from './routes/tasting-notes'
import adviceRouter from './routes/advice'
import labelScanRouter from './routes/label-scan'
import debugRouter from './routes/debug'
import settingsRouter from './routes/settings'
import { getStorage } from './modules/storage'

const app = express()
app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

app.use('/api/wines', winesRouter)
app.use('/api/tasting-notes', tastingNotesRouter)
app.use('/api/advice', adviceRouter)
app.use('/api/label-scan', labelScanRouter)
app.use('/api/debug', debugRouter)
app.use('/api/settings', settingsRouter)

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.message)
  res.status(500).json({ error: err.message })
})

// Phase 9.4, WI-7 — drafts (promoted_at NULL) older than 24h are deleted, on
// server start and once per 24h thereafter. A swept draft takes its
// review_data with it; re-scanning that wine later costs a fresh fetch. See
// CLAUDE.md §15's billing note for why that trade is fine at current volume.
const DRAFT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

function sweepStaleDrafts() {
  const cutoff = new Date(Date.now() - DRAFT_MAX_AGE_MS)
  getStorage()
    .sweepStaleDrafts(cutoff)
    .then((count) => {
      if (count > 0) console.log(`Draft sweep: removed ${count} stale draft(s) older than 24h`)
    })
    .catch((err) => console.error('Draft sweep failed:', err))
}

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  console.log(`Wine app backend listening on port ${PORT}`)
  sweepStaleDrafts()
  setInterval(sweepStaleDrafts, DRAFT_SWEEP_INTERVAL_MS).unref()
})

export default app
