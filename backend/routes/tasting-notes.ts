import { Router, Request, Response, NextFunction } from 'express'
import { getStorage } from '../modules/storage'
import { CreateTastingNoteSchema } from '@shared/validation'
import { extractTags } from '../modules/tasting-notes/tag-extraction'

const router = Router()

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
}

router.post(
  '/',
  wrap(async (req, res) => {
    const result = CreateTastingNoteSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: result.error.format() })
      return
    }
    // Extract tags from aromas + free text before saving.
    // Degrades gracefully: returns aroma-derived tags if no OpenAI key configured.
    const tags = await extractTags(result.data)
    const note = await getStorage().createTastingNote({ ...result.data, tags })
    res.status(201).json(note)
  })
)

// GET /api/tasting-notes — every note, newest first, including notes whose
// wine has been deleted (Phase 12.1, WI-3). The Notes list reads this instead
// of walking wines.latest_tasting_note_id, which a detached note has no wine
// to hang from.
router.get(
  '/',
  wrap(async (_req, res) => {
    res.json(await getStorage().listTastingNotes())
  })
)

router.get(
  '/:id',
  wrap(async (req, res) => {
    const note = await getStorage().getTastingNote(req.params.id)
    if (!note) {
      res.status(404).json({ error: 'Tasting note not found' })
      return
    }
    res.json(note)
  })
)

router.get(
  '/wine/:wineId',
  wrap(async (req, res) => {
    const notes = await getStorage().listTastingNotesByWine(req.params.wineId)
    res.json(notes)
  })
)

export default router
