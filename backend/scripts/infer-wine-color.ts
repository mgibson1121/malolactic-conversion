/**
 * Proposes a colour for every imported wine that has none (Phase 12.4 WI-6).
 * **Dry run only**: reads a private copy of the database, prints the proposal
 * for each wine with its reason, and writes the same to a JSON file for
 * review. Nothing is written to the database. Writing waits for the
 * developer's review and a `wine_color_source` column (the Sourced marker).
 *
 *   npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json \
 *     backend/scripts/infer-wine-color.ts [--out <file.json>]
 *
 * Considered: wines with wine_color null and no label image (a scanned wine's
 * colour comes from the label, Phase 10.5). A colour already set is never
 * proposed over. Cost: one GPT-4o text call per 20 wines; no Serper.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { config } from 'dotenv'
import Database from 'better-sqlite3'
import OpenAI from 'openai'
import { SQLiteAdapter } from '../modules/storage/sqlite-adapter'
import { BATCH_SIZE, inferWineColors, type ColourCandidate } from '../modules/wine-color/infer'

config({ path: path.resolve(__dirname, '../../.env') })

async function main() {
  const args = process.argv.slice(2)
  const outArg = args.indexOf('--out')
  const outFile = outArg >= 0 ? path.resolve(args[outArg + 1]) : null
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const dbPath = process.env.WINE_DB_PATH ? path.resolve(process.env.WINE_DB_PATH) : path.resolve(__dirname, '../db/wine.db')
  const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infer-colour-')), 'copy.db')
  const source = new Database(dbPath, { readonly: true, fileMustExist: true })
  await source.backup(scratch)
  source.close()
  const storage = new SQLiteAdapter(new Database(scratch))

  const wines = (await storage.listWines({ include_drafts: true })).filter(w => w.wine_color == null && !w.label_image_url)
  const calls = Math.ceil(wines.length / BATCH_SIZE)
  console.log(`${wines.length} wines without a colour and without a label scan; ${calls} GPT-4o call${calls === 1 ? '' : 's'} (dry run — nothing is written).\n`)
  if (wines.length === 0) return

  const candidates: ColourCandidate[] = wines.map(w => ({
    id: w.id, producer: w.producer, denomination: w.denomination, cuvee: w.cuvee, vineyard: w.vineyard,
    quality_classification: w.quality_classification, region: w.region, grape_varieties: w.grape_varieties,
  }))
  const proposals = await inferWineColors(candidates, new OpenAI({ apiKey }))

  const rows = proposals.map(p => {
    const w = wines.find(x => x.id === p.id)!
    return { id: p.id, wine: [w.producer, w.denomination, w.cuvee, w.vineyard, w.vintage ?? 'NV'].filter(Boolean).join(' · '), wine_color: p.wine_color, reason: p.reason }
  })
  for (const r of rows) console.log(`${(r.wine_color ?? '—').padEnd(6)} ${r.wine.slice(0, 64).padEnd(64)} ${r.reason}`)
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.wine_color ?? 'null']: (acc[r.wine_color ?? 'null'] ?? 0) + 1 }), {})
  console.log('\n' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · '))
  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify({ generated_at: new Date().toISOString(), dry_run: true, proposals: rows }, null, 2))
    console.log(`written for review: ${outFile}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
