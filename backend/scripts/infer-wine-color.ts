/**
 * Colour for imported wines that have none (Phase 12.4 WI-6), in two steps so
 * nothing is written that the developer has not read:
 *
 *   1. Propose (default, a dry run): reads a private copy of the database,
 *      prints each proposal with its reason, writes them to a JSON file.
 *        … backend/scripts/infer-wine-color.ts --out proposals.json
 *   2. Apply, after review (edit the file — fix or null any line): writes each
 *      non-null proposal whose wine still has no colour, marked
 *      wine_color_source = 'derived' (the Sourced marker). The database is
 *      backed up next to itself first. No model call.
 *        … backend/scripts/infer-wine-color.ts --apply proposals.json
 *
 * Run (1) again after a sheet or CSV import: it only ever looks at wines with
 * no colour.
 *
 *   npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/infer-wine-color.ts …
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
import type { WineColor } from '@shared/types'

config({ path: path.resolve(__dirname, '../../.env') })

/** Step 2: write the reviewed proposals. Only fills a colour that is still empty. */
async function apply(file: string, dbPath: string) {
  const reviewed = JSON.parse(fs.readFileSync(file, 'utf8')) as { proposals: Array<{ id: string; wine_color: WineColor | null; wine?: string }> }
  const backup = `${dbPath}.pre-wine-color-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const source = new Database(dbPath, { fileMustExist: true })
  await source.backup(backup)
  source.close()
  console.log(`backup: ${backup}`)

  const storage = new SQLiteAdapter(new Database(dbPath))
  let written = 0
  let skipped = 0
  for (const p of reviewed.proposals) {
    if (!p.wine_color || !COLOURS.has(p.wine_color)) continue
    const wine = await storage.getWine(p.id)
    if (!wine || wine.wine_color != null) {
      skipped++
      console.log(`skip   ${p.wine ?? p.id} — ${wine ? `already ${wine.wine_color}` : 'not found'}`)
      continue
    }
    await storage.updateWine(p.id, { wine_color: p.wine_color, wine_color_source: 'derived' })
    written++
    console.log(`write  ${p.wine_color.padEnd(6)} ${p.wine ?? p.id}`)
  }
  console.log(`\n${written} written (derived), ${skipped} skipped.`)
}

const COLOURS: ReadonlySet<string> = new Set(['red', 'white', 'rosé'])

async function main() {
  const args = process.argv.slice(2)
  const applyArg = args.indexOf('--apply')
  const dbPathFor = () => (process.env.WINE_DB_PATH ? path.resolve(process.env.WINE_DB_PATH) : path.resolve(__dirname, '../db/wine.db'))
  if (applyArg >= 0) return apply(path.resolve(args[applyArg + 1]), dbPathFor())
  const outArg = args.indexOf('--out')
  const outFile = outArg >= 0 ? path.resolve(args[outArg + 1]) : null
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const dbPath = dbPathFor()
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
