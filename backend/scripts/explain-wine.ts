/**
 * Explains, stage by stage, why one stored wine has the price and reviews it
 * has (Phase 12.2 WI-0). Replays from a copy of the database — no network, no
 * Serper credit, no OpenAI call, and the real file is only ever read.
 *
 *   npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json \
 *     backend/scripts/explain-wine.ts <wine id | producer text> [--vintage 2019]
 *
 * `--live` prints the credit estimate of a fresh primary-tier review run and
 * stops; it never sends anything. A live replay is deliberately not built into
 * this script: use Hard refresh in the app, which states its cost and shows the
 * result, then run this again to read what it stored.
 *
 * `WINE_DB_PATH` points at a copy of the database instead of the real one.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { SQLiteAdapter } from '../modules/storage/sqlite-adapter'
import { explainWine, liveCostEstimate } from './explain-wine-core'

async function main() {
  const args = process.argv.slice(2)
  const live = args.includes('--live')
  const vintageArg = args.indexOf('--vintage')
  const vintage = vintageArg >= 0 ? parseInt(args[vintageArg + 1], 10) : null
  const needle = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--vintage').join(' ').trim()
  if (!needle) {
    console.error('usage: explain-wine <wine id | producer text> [--vintage YYYY] [--live]')
    process.exit(1)
  }

  const dbPath = process.env.WINE_DB_PATH ? path.resolve(process.env.WINE_DB_PATH) : path.resolve(__dirname, '../db/wine.db')
  // Read a private copy, never the real file: the storage adapter runs its
  // idempotent migrations on open, which a diagnostic must not do to the
  // developer's database. The backup API reads consistently even in WAL mode.
  const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'explain-wine-')), 'copy.db')
  const source = new Database(dbPath, { readonly: true, fileMustExist: true })
  await source.backup(scratch)
  source.close()
  const storage = new SQLiteAdapter(new Database(scratch))

  const all = await storage.listWines({ include_drafts: true })
  const lower = needle.toLowerCase()
  const matches = all.filter(w =>
    w.id === needle || w.id.startsWith(needle) ||
    (`${w.producer} ${w.denomination} ${w.cuvee ?? ''} ${w.vineyard ?? ''}`.toLowerCase().includes(lower) && (vintage == null || w.vintage === vintage))
  )
  if (matches.length === 0) {
    console.error(`no wine matches "${needle}"`)
    process.exit(2)
  }
  for (const wine of matches) {
    console.log(explainWine(wine).join('\n'))
    if (live) {
      const { retailers, maxCredits } = liveCostEstimate(wine)
      console.log(`\n--live: a fresh primary-tier review run would query ${retailers} retailers, up to ${maxCredits} Serper credits for this wine. Nothing was sent.`)
    }
    console.log('\n' + '─'.repeat(80) + '\n')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
