import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import winesRouter from './routes/wines'
import tastingNotesRouter from './routes/tasting-notes'
import adviceRouter from './routes/advice'
import labelScanRouter from './routes/label-scan'
import debugRouter from './routes/debug'
import settingsRouter from './routes/settings'
import { parseDeviceTokens, requireDeviceToken, type DeviceToken } from './middleware/device-auth'
import { METERED_ROUTES, meteredLimitsFromEnv, meteredRateLimit, type MeteredLimits } from './middleware/metered-rate-limit'

// Phase 13 WI-1 — the Express app, split from server.ts so it can be built
// and exercised without listening, opening the database or starting the
// draft sweep. Everything environment-specific comes in through AppOptions.

export interface AppOptions {
  /** Origins allowed to call the API from a browser on another origin. */
  corsOrigins: string[]
  /**
   * Directory holding the built web app (`web/dist`). When set, the same
   * process serves it, so the cloud deployment is one origin (spec D3). Unset
   * locally, where Vite serves the web app and proxies `/api`.
   */
  webDistDir?: string | null
  /**
   * Devices allowed to call `/api` (WI-3). Empty turns authentication and the
   * metered rate limit off — local development only; `optionsFromEnv`
   * refuses an empty list in production.
   */
  deviceTokens?: DeviceToken[]
  meteredLimits?: MeteredLimits
}

/** `CORS_ORIGINS` is a comma-separated list; unset keeps the Vite dev origin. */
export function corsOriginsFromEnv(value: string | undefined = process.env.CORS_ORIGINS): string[] {
  const origins = (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return origins.length > 0 ? origins : ['http://localhost:5173']
}

export function optionsFromEnv(env = process.env): AppOptions {
  const deviceTokens = parseDeviceTokens(env.DEVICE_TOKENS)
  // Fail closed: a production start without tokens would put the metered
  // routes, and the keys behind them, on the open internet.
  if (deviceTokens.length === 0 && env.NODE_ENV === 'production') {
    throw new Error('DEVICE_TOKENS is not set; refusing to start in production without device tokens')
  }
  return {
    corsOrigins: corsOriginsFromEnv(env.CORS_ORIGINS),
    webDistDir: env.WEB_DIST_DIR || null,
    deviceTokens,
    meteredLimits: meteredLimitsFromEnv(env),
  }
}

export function createApp(opts: AppOptions = optionsFromEnv()): express.Express {
  const app = express()

  // Fly's proxy terminates TLS and forwards one hop; without this, req.ip is
  // the proxy's address and req.secure is false for every request.
  app.set('trust proxy', 1)

  // Unauthenticated and never touches the database, so the platform's health
  // check neither needs a token nor wakes SQLite (WI-1; stays open under WI-3).
  app.get(['/healthz', '/health'], (_req, res) => res.json({ status: 'ok' }))

  app.use(cors({ origin: opts.corsOrigins }))

  // WI-3 — every /api route needs a device token, and the routes that spend
  // metered APIs are capped per device. Before express.json(), so an
  // unauthenticated request is refused without its body being read. The web
  // bundle served below stays public: it holds no secret, and a browser has
  // to load it to ask for the access key.
  const tokens = opts.deviceTokens ?? []
  if (tokens.length > 0) {
    app.use('/api', requireDeviceToken(tokens))
    const limit = meteredRateLimit(opts.meteredLimits ?? meteredLimitsFromEnv())
    for (const route of METERED_ROUTES) app[route.method](route.path, limit)
  }

  app.use(express.json())

  app.use('/api/wines', winesRouter)
  app.use('/api/tasting-notes', tastingNotesRouter)
  app.use('/api/advice', adviceRouter)
  app.use('/api/label-scan', labelScanRouter)
  app.use('/api/debug', debugRouter)
  app.use('/api/settings', settingsRouter)

  if (opts.webDistDir) serveWebApp(app, opts.webDistDir)

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  })

  return app
}

function serveWebApp(app: express.Express, dir: string): void {
  const indexHtml = path.join(path.resolve(dir), 'index.html')
  // Fail at start, not on the first page load, if the image was built without the web bundle.
  if (!fs.existsSync(indexHtml)) throw new Error(`WEB_DIST_DIR has no index.html: ${dir}`)

  // Vite fingerprints everything under assets/, so those can be cached for
  // good; index.html must be re-read so a deploy is picked up on next load.
  app.use(
    express.static(dir, {
      index: false,
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
      },
    })
  )
  // Any other GET outside /api is the single-page app. An unknown /api path
  // still gets Express's 404, never the HTML page.
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indexHtml)
  })
}
