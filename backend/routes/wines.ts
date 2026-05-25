import { Router, Request, Response, NextFunction } from 'express'
import { getStorage } from '../modules/storage'
import { CreateWineSchema, UpdateWineSchema } from '@shared/validation'
import type { WineFilter } from '@shared/types'

const router = Router()

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
}

router.post(
  '/',
  wrap(async (req, res) => {
    const result = CreateWineSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: result.error.format() })
      return
    }
    const wine = await getStorage().createWine(result.data)
    res.status(201).json(wine)
  })
)

router.get(
  '/',
  wrap(async (req, res) => {
    const filter: WineFilter = {}
    if (req.query.tag_discovered === 'true') filter.tag_discovered = true
    if (req.query.tag_wishlist === 'true') filter.tag_wishlist = true
    if (req.query.tag_cellar === 'true') filter.tag_cellar = true
    if (req.query.tag_consumed === 'true') filter.tag_consumed = true
    if (req.query.has_tasting_note === 'true') filter.has_tasting_note = true
    if (req.query.my_rating) filter.my_rating = req.query.my_rating as WineFilter['my_rating']
    if (req.query.region) filter.region = String(req.query.region)
    const wines = await getStorage().listWines(filter)
    res.json(wines)
  })
)

router.get(
  '/:id',
  wrap(async (req, res) => {
    const wine = await getStorage().getWine(req.params.id)
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' })
      return
    }
    res.json(wine)
  })
)

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const result = UpdateWineSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: result.error.format() })
      return
    }
    const wine = await getStorage().updateWine(req.params.id, result.data)
    res.json(wine)
  })
)

export default router
