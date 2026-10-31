/**
 * Before/after for the Phase 12.2 device-test cases (WI-8), offline: reads a
 * private copy of the database (no network, no metered call, the real file only
 * read) and prints, per wine, what is *stored* beside what the 12.2 rules give
 * from the same stored listings and pages.
 *
 *   npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/snapshot-12-2.ts
 *
 * Stored blobs are not rewritten by 12.2, so "before" is what the database
 * holds and "after" is the recomputation: the headline, the critic order, the
 * tier and the prompt. `WINE_DB_PATH` points at a copy instead.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { SQLiteAdapter } from '../modules/storage/sqlite-adapter'
import { aggregatePriceData } from '../modules/price/aggregate'
import type { RetailerResult } from '../modules/price/types'
import type { WineEntry } from '@shared/types'

const CASES = ['Marcoux', 'Vietti', 'Girardin', 'Pavillon', 'Joseph Colin', 'Villaine', 'Covalli', 'Cielo']

const money = (n: number | null | undefined) => (n == null ? '—' : `$${n}`)

async function main() {
  const dbPath = process.env.WINE_DB_PATH ? path.resolve(process.env.WINE_DB_PATH) : path.resolve(__dirname, '../db/wine.db')
  const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-12-2-')), 'copy.db')
  const source = new Database(dbPath, { readonly: true, fileMustExist: true })
  await source.backup(scratch)
  source.close()
  const storage = new SQLiteAdapter(new Database(scratch))
  const all = await storage.listWines({ include_drafts: true })

  console.log('| Wine | Price before | Price after (12.2 rules, same listings) | Reviews before (card badge) | Reviews after (tier · badge) | Prompt |')
  console.log('|---|---|---|---|---|---|')
  for (const needle of CASES) {
    for (const w of all.filter((x: WineEntry) => `${x.producer} ${x.denomination} ${x.cuvee ?? ''}`.toLowerCase().includes(needle.toLowerCase()))) {
      const p = w.price_data
      const before = p ? (p.price_avg == null ? `none counted (${p.retailers.length} listings)` : `${money(p.price_min)}–${money(p.price_max)} avg ${money(p.price_avg)}`) : 'never fetched'
      let after = '—'
      if (p) {
        const agg = aggregatePriceData(p.retailers as unknown as RetailerResult[])
        after =
          agg.headline_basis === 'ambiguous'
            ? `split: ${agg.price_groups!.map(g => `${money(g.min)}–${money(g.max)}`).join(' / ')}`
            : agg.price_avg == null
              ? `none counted (${agg.retailers.length} listings)`
              : `${money(agg.price_min)}–${money(agg.price_max)} avg ${money(agg.price_avg)}${agg.headline_estimated ? ' (estimated)' : ''}`
      }
      const first = (() => {
        const rd = w.review_data
        if (!rd) return 'never fetched'
        const scores = rd.flatMap(r => r.critic_scores)
        return scores.length ? `${scores.length} scores` : 'no scores'
      })()
      const top = w.critic_summary?.ordered[0]
      const tier = w.review_ladder?.tier ?? '—'
      const afterReviews = `${tier === 'none' ? 'none' : `Tier ${tier}`}${top ? ` · ${top.score} ${top.publication}${top.bottling_badge ? ' (different bottling)' : ''}` : ''}`
      const prompt = w.bottling_prompt ? w.bottling_prompt.options.map(o => o.name).join(', ') || w.bottling_prompt.reasons.join('+') : '—'
      console.log(`| ${w.producer} ${w.denomination} ${w.vintage ?? 'NV'} | ${before} | ${after} | ${first} | ${afterReviews} | ${prompt} |`)
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
