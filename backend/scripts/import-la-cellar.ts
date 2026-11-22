/**
 * Imports the LA-cellar list into the REAL database, through the real API, and
 * enriches each wine (price, then reviews at tier=full) as the apps do.
 *
 * Safety: (1) backs up the database first (backend/db/wine.db.pre-la-import-<time>,
 * covered by the wine.db* gitignore pattern); (2) runs every wine through the
 * free duplicate check and SKIPS any possible duplicate rather than creating
 * it, so re-running is safe; (3) creates each wine with the Cellar tag and one
 * bottle, then promotes it so it is not a 24-hour draft; (4) verifies the
 * result by reading the cellar list back.
 *
 * Spends real Serper/GPT-4o credits for the enrichment (about 230 requests last
 * time for the same 16 wines). Set IMPORT_ENRICH=0 to import without fetching.
 *
 *   npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/import-la-cellar.ts
 *
 * Output: a markdown summary plus Claude outputs/la-cellar-import-results.{md,json}.
 */
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { WINES, type Input } from './la-cellar-list'

const PORT = process.env.IMPORT_PORT ?? '3998'
const BASE = `http://localhost:${PORT}`
const ENRICH = process.env.IMPORT_ENRICH !== '0'
const DB_PATH = process.env.WINE_DB_PATH ? path.resolve(process.env.WINE_DB_PATH) : path.resolve(__dirname, '../db/wine.db')
process.env.PORT = PORT // a different port, so a running dev backend on 3000 is not disturbed

async function api(method: string, url: string, body?: unknown): Promise<any> {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

const usd = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n)}`)

async function importOne(w: Input) {
  const dup = await api('POST', '/api/wines/duplicate-check', {
    producer: w.producer, denomination: w.denomination, vintage: w.vintage,
    cuvee: w.cuvee ?? null, vineyard: w.vineyard ?? null, quality_classification: w.quality_classification ?? null,
  })
  if (dup && dup.kind !== 'none') {
    return { label: w.label, status: 'SKIPPED — possible duplicate already in the collection', id: null as string | null, detail: JSON.stringify(dup).slice(0, 200), errors: [] as string[] }
  }
  const created = await api('POST', '/api/wines', {
    producer: w.producer, denomination: w.denomination, vintage: w.vintage, region: w.region,
    quality_classification: w.quality_classification ?? null, vineyard: w.vineyard ?? null, cuvee: w.cuvee ?? null,
    tag_cellar: true, cellar_quantity: 1,
  })
  const id: string = created.id
  await api('POST', `/api/wines/${id}/promote`, { tag_cellar: true })
  const errors: string[] = []
  if (ENRICH) {
    try { await api('POST', `/api/wines/${id}/fetch-price`) } catch (e) { errors.push(`price: ${(e as Error).message}`) }
    try { await api('POST', `/api/wines/${id}/fetch-reviews?tier=full`) } catch (e) { errors.push(`reviews: ${(e as Error).message}`) }
  }
  const wine = await api('GET', `/api/wines/${id}`)
  const ladder = wine.review_ladder
  const scores = (ladder?.rungs ?? []).reduce((n: number, r: any) => n + r.scores, 0)
  const p = wine.price_data
  const price = !p ? 'not fetched' : p.price_avg != null ? `${usd(p.price_min)}–${usd(p.price_max)} avg ${usd(p.price_avg)}` : wine.price_exclusions?.sentence ?? 'none counted'
  return {
    label: w.label, status: 'IMPORTED', id,
    detail: ENRICH ? `tier ${ladder?.tier ?? 'none'} · ${scores} scores · ${p?.retailers?.length ?? 0} listings · ${price}` : 'no enrichment requested',
    errors,
  }
}

async function main() {
  // 1. Back up before anything touches the file (and before migrations run on server start).
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${DB_PATH}.pre-la-import-${stamp}`
  const src = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  await src.backup(backupPath)
  src.close()
  const peek = new Database(backupPath, { readonly: true })
  const before = (peek.prepare('SELECT COUNT(*) AS n FROM wines WHERE promoted_at IS NOT NULL').get() as { n: number }).n
  peek.close()
  console.error(`Backed up ${DB_PATH} -> ${backupPath} (${before} saved wines before)`)

  await import('../server')
  if (ENRICH && (!process.env.SERPER_API_KEY || !process.env.OPENAI_API_KEY)) {
    console.error('SERPER_API_KEY and OPENAI_API_KEY must be set in .env to enrich — nothing was imported. (Or run with IMPORT_ENRICH=0.)')
    process.exit(1)
  }
  for (let i = 0; i < 50; i++) { try { await api('GET', '/health'); break } catch { await new Promise((r) => setTimeout(r, 200)) } }

  const results: Awaited<ReturnType<typeof importOne>>[] = []
  let next = 0
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < WINES.length) {
      const w = WINES[next++]
      try {
        const r = await importOne(w)
        results.push(r)
        console.error(`${results.length}/${WINES.length} ${r.status}: ${w.label} ${r.errors.length ? `(errors: ${r.errors.join('; ')})` : ''}`)
      } catch (e) {
        results.push({ label: w.label, status: 'FAILED', id: null, detail: (e as Error).message, errors: [] })
        console.error(`FAILED ${w.label}: ${(e as Error).message}`)
      }
    }
  }))
  results.sort((a, b) => WINES.findIndex((w) => w.label === a.label) - WINES.findIndex((w) => w.label === b.label))

  // 2. Verify by reading back.
  const cellar: any[] = await api('GET', '/api/wines?tag_cellar=true')
  const imported = results.filter((r) => r.status === 'IMPORTED')
  const missing = imported.filter((r) => !cellar.some((c) => c.id === r.id && c.cellar_quantity === 1 && c.tag_cellar))
  const verify = new Database(DB_PATH, { readonly: true })
  const after = (verify.prepare('SELECT COUNT(*) AS n FROM wines WHERE promoted_at IS NOT NULL').get() as { n: number }).n
  verify.close()

  const md = [
    '| # | Wine | Result | Detail |', '|---|---|---|---|',
    ...results.map((r, i) => `| ${i + 1} | ${r.label} | ${r.status} | ${r.detail}${r.errors.length ? ` · ERRORS: ${r.errors.join('; ')}` : ''} |`),
    '',
    `Saved wines before: ${before} · after: ${after} · imported: ${imported.length} · skipped: ${results.filter((r) => r.status.startsWith('SKIPPED')).length} · failed: ${results.filter((r) => r.status === 'FAILED').length}`,
    `Read-back check: ${missing.length === 0 ? 'all imported wines present in the Cellar list with 1 bottle' : `MISSING/WRONG: ${missing.map((m) => m.label).join(', ')}`}`,
    `Backup: ${backupPath}`,
  ].join('\n')
  console.log(md)
  const outDir = path.resolve(__dirname, '../../Claude outputs')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'la-cellar-import-results.md'), md + '\n')
  fs.writeFileSync(path.join(outDir, 'la-cellar-import-results.json'), JSON.stringify({ ran_at: new Date().toISOString(), before, after, backup: backupPath, results, serper_usage: await api('GET', '/api/debug/serper-usage') }, null, 2))
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
