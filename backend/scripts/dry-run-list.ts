/**
 * Dry run of a list of wines through the real price + review pipeline, to see
 * which rung of the Phase 12.2 review ladder each lands on and how many results
 * come back — without touching the real database.
 *
 * How it stays safe: it points the backend at a throwaway SQLite file
 * (WINE_DB_PATH in the OS temp dir), starts the real Express app on a spare
 * port, and drives it over HTTP exactly as the apps do (create wine → fetch
 * price → fetch reviews, tier=full → read the wine back). Nothing is written to
 * backend/db/wine.db, and the temp file is deleted at the end.
 *
 * It spends REAL Serper credits and GPT-4o calls (roughly 30–45 Serper credits
 * and a few cents of GPT-4o per wine; see the cost note in the PR/session).
 *
 *   npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json backend/scripts/dry-run-list.ts
 *
 * Env: DRYRUN_ONLY="clos des papes" (substring filter, run a cheap control first),
 *      DRYRUN_LIMIT=3, DRYRUN_CONCURRENCY=2, DRYRUN_PORT=3999.
 * Output: a markdown table on stdout, plus Claude outputs/dry-run-list-results.{md,json}.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

import { WINES, type Input } from './la-cellar-list'

const PORT = process.env.DRYRUN_PORT ?? '3999'
const BASE = `http://localhost:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-run-list-'))
// Must be set before the server (and its storage layer) is imported.
process.env.WINE_DB_PATH = path.join(TMP, 'dry-run.db')
process.env.PORT = PORT

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

async function runOne(w: Input) {
  const started = Date.now()
  const created = await api('POST', '/api/wines', {
    producer: w.producer,
    denomination: w.denomination,
    vintage: w.vintage,
    region: w.region,
    quality_classification: w.quality_classification ?? null,
    vineyard: w.vineyard ?? null,
    cuvee: w.cuvee ?? null,
  })
  const id: string = created.id
  const errors: string[] = []
  // Price first so reviews can use the retailers it discovered (router cross-feed).
  try { await api('POST', `/api/wines/${id}/fetch-price`) } catch (e) { errors.push(`price: ${(e as Error).message}`) }
  try { await api('POST', `/api/wines/${id}/fetch-reviews?tier=full`) } catch (e) { errors.push(`reviews: ${(e as Error).message}`) }
  const wine = await api('GET', `/api/wines/${id}`)

  const ladder = wine.review_ladder
  const rungs: any[] = ladder?.rungs ?? []
  const pagesFound: number = (wine.review_data ?? []).length
  const pagesScored: number = (ladder?.pages ?? []).filter((p: any) => p.scores > 0).length
  const scores = rungs.reduce((n, r) => n + r.scores, 0)
  const trusted = rungs.reduce((n, r) => n + r.trusted_scores, 0)
  const top = wine.critic_summary?.ordered?.[0]
  const p = wine.price_data
  return {
    label: w.label,
    note: w.note ?? null,
    id,
    seconds: Math.round((Date.now() - started) / 1000),
    tier: (ladder?.tier ?? 'none') as string,
    rungs: rungs.map((r) => `${r.tier}: ${r.pages}p/${r.scores}s`).join(', ') || '—',
    review_pages_found: pagesFound,
    review_pages_with_scores: pagesScored,
    scores,
    trusted_scores: trusted,
    top: top ? `${top.score} ${top.publication}${top.rung ? ` (rung ${top.rung})` : ''}${top.vintage_delta ? ` ${top.vintage_delta > 0 ? '+' : ''}${top.vintage_delta}y` : ''}` : '—',
    bottling_flag: top?.bottling_badge ?? null,
    bottling_prompt: wine.bottling_prompt ? 'asks' : null,
    price_listings: p?.retailers?.length ?? null,
    price: !p ? 'not fetched' : p.price_avg != null ? `${usd(p.price_min)}–${usd(p.price_max)} avg ${usd(p.price_avg)}${p.headline_estimated ? ' (est.)' : ''}` : p.headline_basis === 'ambiguous' ? 'split (ambiguous)' : wine.price_exclusions?.sentence ?? 'none counted',
    errors,
  }
}

async function main() {
  const only = process.env.DRYRUN_ONLY?.toLowerCase()
  const limit = Number(process.env.DRYRUN_LIMIT ?? WINES.length)
  const concurrency = Number(process.env.DRYRUN_CONCURRENCY ?? 2)
  const list = WINES.filter((w) => !only || w.label.toLowerCase().includes(only)).slice(0, limit)

  await import('../server') // loads .env, runs migrations on the temp DB, listens on PORT
  if (!process.env.SERPER_API_KEY || !process.env.OPENAI_API_KEY) {
    console.error('SERPER_API_KEY and OPENAI_API_KEY must be set in .env — nothing was spent.')
    process.exit(1)
  }
  for (let i = 0; i < 50; i++) {
    try { await api('GET', '/health'); break } catch { await new Promise((r) => setTimeout(r, 200)) }
  }
  if (!process.env.WINE_DB_PATH!.startsWith(TMP)) throw new Error('refusing to run against a non-temp database')
  await api('POST', '/api/debug/serper-usage/reset')
  console.error(`Running ${list.length} wine(s), concurrency ${concurrency}, temp DB ${process.env.WINE_DB_PATH}`)

  const results: Awaited<ReturnType<typeof runOne>>[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < list.length) {
        const w = list[next++]
        try {
          const r = await runOne(w)
          results.push(r)
          console.error(`done ${results.length}/${list.length}: ${w.label} -> tier ${r.tier}, ${r.scores} scores, ${r.seconds}s`)
        } catch (e) {
          console.error(`FAILED ${w.label}: ${(e as Error).message}`)
        }
      }
    })
  )
  results.sort((a, b) => WINES.findIndex((w) => w.label === a.label) - WINES.findIndex((w) => w.label === b.label))
  const usage = await api('GET', '/api/debug/serper-usage')

  const rows = [
    '| # | Wine (as entered) | Review tier | Rungs (pages/scores) | Pages found → with scores | Scores (trusted) | Top score | Bottling flag | Price listings | Price |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...results.map((r, i) => `| ${i + 1} | ${r.label}${r.note ? ` *(${r.note})*` : ''} | ${r.tier === 'none' ? 'none' : `Tier ${r.tier}`} | ${r.rungs} | ${r.review_pages_found} → ${r.review_pages_with_scores} | ${r.scores} (${r.trusted_scores}) | ${r.top} | ${r.bottling_prompt ? 'asks "Which bottling?"' : r.bottling_flag ?? '—'} | ${r.price_listings ?? '—'} | ${r.price} |`),
  ]
  const md = rows.join('\n')
  console.log(md)
  console.log('\nSerper usage (raw):', JSON.stringify(usage))
  const outDir = path.resolve(__dirname, '../../Claude outputs')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'dry-run-list-results.md'), md + '\n')
  fs.writeFileSync(path.join(outDir, 'dry-run-list-results.json'), JSON.stringify({ ran_at: new Date().toISOString(), results, serper_usage: usage }, null, 2))
  fs.rmSync(TMP, { recursive: true, force: true })
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  fs.rmSync(TMP, { recursive: true, force: true })
  process.exit(1)
})
