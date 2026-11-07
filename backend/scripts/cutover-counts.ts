/**
 * Phase 13.1 WI-3 — do the laptop copy and production hold the same collection?
 *
 * Prints one table: the frozen laptop copy (read-only, straight from the file)
 * beside production (through the authenticated API: three GETs, no metered
 * call), and exits non-zero unless every row matches. Cutover steps 3 and 6
 * (docs/ops/runbook.md, "Data cutover").
 *
 *   npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json \
 *     backend/scripts/cutover-counts.ts --db cutover-YYYYMMDD.db            # both sides
 *   npx ts-node ... backend/scripts/cutover-counts.ts --db cutover-YYYYMMDD.db --laptop-only  # step 3
 *
 * Production's address and key come from `WINE_API_TARGET` (default
 * https://malolactic-conversion.fly.dev) and `WINE_ACCESS_KEY` in the repo
 * `.env` or the environment, the same pair the web dev server uses. The key is
 * never printed.
 *
 * Drafts: production's server removes drafts older than 24 hours when it
 * starts, as the laptop's does. The laptop copy is unswept, so the drafts row
 * is compared against the laptop drafts younger than 24 hours, and the stale
 * ones are listed separately rather than counted as a mismatch.
 */
import path from 'path'
import Database from 'better-sqlite3'
import { config } from 'dotenv'

export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const DEFAULT_TARGET = 'https://malolactic-conversion.fly.dev'

export interface CollectionCounts {
  /** Every wine, drafts included (after the 24-hour sweep). */
  wines: number
  promoted: number
  drafts: number
  tastingNotes: number
  cellarCapacity: number | null
  /** Sorted ids of promoted wines; compared as a set, printed as a count. */
  promotedIds: string[]
}

export interface LaptopCounts extends CollectionCounts {
  /** Drafts the production server will sweep on start; not compared. */
  staleDrafts: number
}

export interface Row {
  label: string
  laptop: string
  production: string
  match: boolean
}

interface WineLike {
  id: string
  promoted_at: string | null
  date_added: string
}

/** Counts from rows shaped like the API's (`/api/wines?include_drafts=true`). */
export function countWines(wines: WineLike[], notes: number, cellarCapacity: number | null, now?: Date) {
  const cutoff = now ? now.getTime() - DRAFT_MAX_AGE_MS : null
  const promoted = wines.filter(w => w.promoted_at !== null)
  const allDrafts = wines.filter(w => w.promoted_at === null)
  // Same rule as sweepStaleDrafts: `date_added < cutoff` is removed.
  const stale = cutoff === null ? [] : allDrafts.filter(w => Date.parse(w.date_added) < cutoff)
  const drafts = allDrafts.length - stale.length
  return {
    wines: promoted.length + drafts,
    promoted: promoted.length,
    drafts,
    tastingNotes: notes,
    cellarCapacity,
    promotedIds: promoted.map(w => w.id).sort(),
    staleDrafts: stale.length,
  }
}

export function readLaptop(dbPath: string, now: Date): LaptopCounts {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const wines = db.prepare('SELECT id, promoted_at, date_added FROM wines').all() as WineLike[]
    const notes = (db.prepare('SELECT COUNT(*) AS n FROM tasting_notes').get() as { n: number }).n
    const settings = db.prepare('SELECT cellar_capacity FROM app_settings WHERE id = 1').get() as
      | { cellar_capacity: number | null }
      | undefined
    return countWines(wines, notes, settings?.cellar_capacity ?? null, now)
  } finally {
    db.close()
  }
}

export async function readProduction(
  target: string,
  key: string,
  fetchImpl: typeof fetch = fetch
): Promise<CollectionCounts> {
  const get = async <T>(route: string): Promise<T> => {
    const res = await fetchImpl(`${target.replace(/\/+$/, '')}${route}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
    if (!res.ok) {
      const hint = res.status === 401 ? ' (is WINE_ACCESS_KEY one of production\'s device keys?)' : ''
      throw new Error(`GET ${route} returned ${res.status}${hint}`)
    }
    return (await res.json()) as T
  }
  const [wines, notes, settings] = await Promise.all([
    get<WineLike[]>('/api/wines?include_drafts=true'),
    get<unknown[]>('/api/tasting-notes'),
    get<{ cellar_capacity: number | null }>('/api/settings'),
  ])
  // Production has already swept its stale drafts, so no cutoff here.
  const { staleDrafts: _ignored, ...counts } = countWines(wines, notes.length, settings.cellar_capacity)
  return counts
}

const show = (v: number | null) => (v === null ? 'unset' : String(v))

export function compare(laptop: LaptopCounts, production: CollectionCounts): Row[] {
  const sameIds =
    laptop.promotedIds.length === production.promotedIds.length &&
    laptop.promotedIds.every((id, i) => id === production.promotedIds[i])
  const row = (label: string, a: number | null, b: number | null): Row => ({
    label,
    laptop: show(a),
    production: show(b),
    match: a === b,
  })
  return [
    row('Wines (incl. drafts)', laptop.wines, production.wines),
    row('Promoted wines', laptop.promoted, production.promoted),
    row('Drafts (< 24 h old)', laptop.drafts, production.drafts),
    row('Tasting notes', laptop.tastingNotes, production.tastingNotes),
    row('Settings: cellar capacity', laptop.cellarCapacity, production.cellarCapacity),
    {
      label: 'Promoted wine ids',
      laptop: `${laptop.promotedIds.length} ids`,
      production: sameIds ? 'same set' : `${production.promotedIds.length} ids, DIFFERENT`,
      match: sameIds,
    },
  ]
}

export function formatTable(rows: Row[]): string {
  const w0 = Math.max(...rows.map(r => r.label.length), 'Count'.length)
  const w1 = Math.max(...rows.map(r => r.laptop.length), 'Laptop'.length)
  const w2 = Math.max(...rows.map(r => r.production.length), 'Production'.length)
  const line = (a: string, b: string, c: string, d: string) =>
    `${a.padEnd(w0)}  ${b.padStart(w1)}  ${c.padStart(w2)}  ${d}`
  return [
    line('Count', 'Laptop', 'Production', ''),
    line('-'.repeat(w0), '-'.repeat(w1), '-'.repeat(w2), ''),
    ...rows.map(r => line(r.label, r.laptop, r.production, r.match ? 'ok' : 'MISMATCH')),
  ].join('\n')
}

function laptopOnlyTable(laptop: LaptopCounts): string {
  const rows: Array<[string, string]> = [
    ['Wines (incl. drafts)', String(laptop.wines)],
    ['Promoted wines', String(laptop.promoted)],
    ['Drafts (< 24 h old)', String(laptop.drafts)],
    ['Tasting notes', String(laptop.tastingNotes)],
    ['Settings: cellar capacity', show(laptop.cellarCapacity)],
  ]
  const w = Math.max(...rows.map(r => r[0].length))
  return rows.map(([a, b]) => `${a.padEnd(w)}  ${b}`).join('\n')
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<number> {
  config({ path: path.resolve(__dirname, '../../.env') })
  const dbArg = arg('--db')
  if (!dbArg) {
    console.error('Usage: cutover-counts.ts --db <laptop copy> [--laptop-only]')
    return 2
  }
  const dbPath = path.resolve(dbArg)
  const now = new Date()
  const laptop = readLaptop(dbPath, now)

  console.log(`Laptop copy: ${dbPath}`)
  if (process.argv.includes('--laptop-only')) {
    console.log(laptopOnlyTable(laptop))
  } else {
    const target = process.env.WINE_API_TARGET || DEFAULT_TARGET
    const key = process.env.WINE_ACCESS_KEY
    if (!key) {
      console.error('WINE_ACCESS_KEY is not set (repo .env or environment); production needs a device key.')
      return 2
    }
    console.log(`Production:  ${target}\n`)
    const rows = compare(laptop, await readProduction(target, key))
    console.log(formatTable(rows))
    const mismatches = rows.filter(r => !r.match).length
    console.log(mismatches === 0 ? '\nAll counts match.' : `\n${mismatches} MISMATCH(ES). Do not switch over; see the runbook's rollback.`)
    if (laptop.staleDrafts > 0) {
      console.log(`(${laptop.staleDrafts} laptop draft(s) older than 24 h are not counted; production sweeps them on start.)`)
    }
    return mismatches === 0 ? 0 : 1
  }
  if (laptop.staleDrafts > 0) {
    console.log(`(${laptop.staleDrafts} draft(s) older than 24 h not counted; production sweeps them on start.)`)
  }
  return 0
}

if (require.main === module) {
  main().then(
    code => process.exit(code),
    err => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    }
  )
}
