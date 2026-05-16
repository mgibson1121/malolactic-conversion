/**
 * routes/label-scan.ts
 * POST /api/label-scan
 *
 * Accepts a multipart/form-data image upload (field name: "label"),
 * runs the GPT-4o label scan module, and returns structured JSON.
 *
 * Gracefully returns 503 if OPENAI_API_KEY is not configured.
 */

import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { scanLabel } from '../modules/label-scan'

const router = Router()

// Keep image in memory — never write to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB ceiling — label photos are always smaller
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are accepted'))
      return
    }
    cb(null, true)
  },
})

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
}

router.post(
  '/',
  upload.single('label'),
  wrap(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided. Send a multipart/form-data request with field name "label".' })
      return
    }

    const response = await scanLabel({
      imageBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
    })

    if (!response.available) {
      res.status(503).json({
        error: 'Label scanning is unavailable — OPENAI_API_KEY is not configured.',
        reason: response.reason,
      })
      return
    }

    res.json(response.result)
  })
)

export default router
