import { Router, Request, Response, NextFunction } from 'express'
import { getStorage } from '../modules/storage'
import { SettingsSchema } from '@shared/validation'

// Phase 10.5 — app-level (not per-wine) settings. Currently just
// cellar_capacity, which the Cellar tab's "capacity used" stat divides into.

const router = Router()

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
}

router.get(
  '/',
  wrap(async (_req, res) => {
    const settings = await getStorage().getSettings()
    res.json(settings)
  })
)

router.put(
  '/',
  wrap(async (req, res) => {
    const result = SettingsSchema.partial().safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: result.error.format() })
      return
    }
    const settings = await getStorage().updateSettings(result.data)
    res.json(settings)
  })
)

export default router
