import dotenv from 'dotenv'
import path from 'path'

// .env lives at the monorepo root, one level above backend/
dotenv.config({ path: path.resolve(__dirname, '../../.env') })
