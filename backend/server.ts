import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(__dirname, '../.env') })
import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import winesRouter from './routes/wines'
import tastingNotesRouter from './routes/tasting-notes'
import adviceRouter from './routes/advice'

const app = express()
app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

app.use('/api/wines', winesRouter)
app.use('/api/tasting-notes', tastingNotesRouter)
app.use('/api/advice', adviceRouter)

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.message)
  res.status(500).json({ error: err.message })
})

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  console.log(`Wine app backend listening on port ${PORT}`)
})

export default app
