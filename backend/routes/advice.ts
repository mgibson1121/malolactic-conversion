import { Router, Request, Response, NextFunction } from 'express'
import { getStorage } from '../modules/storage'
import { CreateAdviceSchema } from '@shared/validation'
import type { AdviceFilter } from '@shared/types'

const router = Router()

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
}

router.post(
  '/',
  wrap(async (req, res) => {
    const result = CreateAdviceSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: result.error.format() })
      return
    }
    const entry = await getStorage().createAdvice(result.data)
    res.status(201).json(entry)
  })
)

router.get(
  '/',
  wrap(async (req, res) => {
    const filter: AdviceFilter = {}
    if (req.query.category) filter.category = req.query.category as AdviceFilter['category']
    if (req.query.wine_id) filter.wine_id = String(req.query.wine_id)
    const entries = await getStorage().listAdvice(filter)
    res.json(entries)
  })
)

router.get(
  '/:id',
  wrap(async (req, res) => {
    const entry = await getStorage().getAdvice(req.params.id)
    if (!entry) {
      res.status(404).json({ error: 'Advice entry not found' })
      return
    }
    res.json(entry)
  })
)

export default router
