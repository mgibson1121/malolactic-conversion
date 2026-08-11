/**
 * Snapshot / purge / diff for the enrichment columns (Phase 9.1, WI-9).
 *
 * Phase 9.1 changes what the pipeline stores, so the only honest way to
 * evaluate it is to keep the old state, clear it, re-run, and compare. This
 * script owns the first, second and fourth of those; the re-run itself is
 * the app's own POST /:id/fetch-price and /:id/fetch-reviews, so that the
 * thing being measured is the real code path rather than a copy of it here.
 *
 * Three subcommands:
 *
 *   snapshot [--out <path>]
 *     Writes price_data / review_data / retailer_links for every wine to
 *     backend/tests/fixtures/enrichment-before-2026-08-04.json. Committed —
 *     it is the "before" half of the comparison and cannot be regenerated
 *     once the columns are cleared.
 *
 *   purge --date 2026-08-04 [--yes]
 *     Clears those three columns for wines added on that date. Refuses to
 *     run unless a snapshot exists that covers every wine it would clear,
 *     and refuses to run without --yes. This is destructive and the data is
 *     not re-derivable except by spending API budget.
 *
 *   diff [--before <path>] [--date 2026-08-04]
 *     Compares the current DB against a snapshot and reports what changed:
 *     retailer and score counts, dead links (a constructed retailer URL
 *     containing a vintage token), wrong-producer scores, and how many
 *     stored scores now carry a vintage verdict at all.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register --project backend/tsconfig.json \
 *     backend/scripts/snapshot-enrichment.ts snapshot
 */
import { config } from 'dotenv'
import path from 'path'
config({ path: path.resolve(__dirname, '../../.env') })

import fs from 'fs'
import { openDatabase } from '../db/migrate'
import type { PriceData, RetailerReview } from '@shared/types'
import { scoreMatch } from '@shared/utils/wine-match'

const DEFAULT_SNAPSHOT = path.resolve(__dirname, '../tests/fixtures/enrichment-before-2026-08-04.json')
const DEFAULT_DATE = '2026-08-04'

interface WineRow {
  id: string
  producer: string | null
  vintage: number | null
  denomination: string | null
  date_added: string
  price_data: string | null
  review_data: string | null
  retailer_links: string | null
}

interface SnapshotEntry {
  id: string
  label: string
  producer: string | null
  vintage: number | null
  denomination: string | null
  date_added: string
  price_data: PriceData | null
  review_data: RetailerReview[] | null
  retailer_links: Record<string, string> | null
}

interface Snapshot {
  taken_at: string
  note: string
  wines: SnapshotEntry[]
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function label(row: Pick<WineRow, 'producer' | 'vintage' | 'denomination'>): string {
  return `${row.producer ?? '(no producer)'} · ${row.denomination ?? '(no denomination)'} ${row.vintage ?? 'NV'}`
}

function readWines(): WineRow[] {
  const db = openDatabase()
  try {
    return db
      .prepare(
        'SELECT id, producer, vintage, denomination, date_added, price_data, review_data, retailer_links FROM wines ORDER BY date_added, producer'
      )
      .all() as WineRow[]
  } finally {
    db.close()
  }
}

function toEntry(row: WineRow): SnapshotEntry {
  return {
    id: row.id,
    label: label(row),
    producer: row.producer,
    vintage: row.vintage,
    denomination: row.denomination,
    date_added: row.date_added,
    price_data: parseJson<PriceData>(row.price_data),
    review_data: parseJson<RetailerReview[]>(row.review_data),
    retailer_links: parseJson<Record<string, string>>(row.retailer_links),
  }
}

// ─── snapshot ────────────────────────────────────────────────────────────────

function commandSnapshot(outPath: string): void {
  const wines = readWines().map(toEntry)
  const snapshot: Snapshot = {
    taken_at: new Date().toISOString(),
    note:
      'Enrichment state before the Phase 9.1 identity-matching remediation. ' +
      'The "before" half of the before/after comparison, and the evidence behind ' +
      'docs/sessions/2026-08-04-core-functionality-defect-taxonomy.md. Not re-derivable once purged.',
    wines,
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2))

  const withPrice = wines.filter(w => w.price_data !== null).length
  const withReviews = wines.filter(w => w.review_data !== null).length
  const scores = wines.reduce((n, w) => n + (w.review_data ?? []).reduce((m, r) => m + r.critic_scores.length, 0), 0)
  console.log(`Wrote ${outPath}`)
  console.log(`  ${wines.length} wines — ${withPrice} with price_data, ${withReviews} with review_data, ${scores} stored critic scores`)
}

// ─── purge ───────────────────────────────────────────────────────────────────

function commandPurge(datePrefix: string, snapshotPath: string, confirmed: boolean): void {
  const snapshot = parseJson<Snapshot>(fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath, 'utf-8') : null)
  if (!snapshot) {
    console.error(`No usable snapshot at ${snapshotPath}. Run \`snapshot\` first — purged data is not re-derivable.`)
    process.exit(1)
  }

  const targets = readWines().filter(w => (w.date_added ?? '').startsWith(datePrefix))
  if (targets.length === 0) {
    console.log(`No wines added on ${datePrefix}. Nothing to do.`)
    return
  }

  // Every wine about to be cleared must be in the snapshot — otherwise the
  // "before" half of the comparison has a hole in exactly the rows that
  // matter, and there is no way to notice after the fact.
  const snapshotIds = new Set(snapshot.wines.map(w => w.id))
  const missing = targets.filter(w => !snapshotIds.has(w.id))
  if (missing.length > 0) {
    console.error(`Snapshot at ${snapshotPath} is missing ${missing.length} of the ${targets.length} wines this would clear:`)
    for (const w of missing) console.error(`  ${label(w)}`)
    console.error('Re-run `snapshot` before purging.')
    process.exit(1)
  }

  if (!confirmed) {
    console.log(`Would clear price_data, review_data and retailer_links for ${targets.length} wines added ${datePrefix}:`)
    for (const w of targets) console.log(`  ${label(w)}`)
    console.log(`\nSnapshot at ${snapshotPath} covers all of them. Re-run with --yes to proceed.`)
    return
  }

  const db = openDatabase()
  try {
    const stmt = db.prepare('UPDATE wines SET price_data = NULL, review_data = NULL, retailer_links = NULL WHERE id = ?')
    const clearAll = db.transaction((rows: WineRow[]) => {
      for (const row of rows) stmt.run(row.id)
    })
    clearAll(targets)
  } finally {
    db.close()
  }

  console.log(`Cleared enrichment columns for ${targets.length} wines added ${datePrefix}.`)
  console.log('Re-run enrichment via POST /api/wines/:id/fetch-price and /:id/fetch-reviews, then `diff`.')
}

// ─── diff ────────────────────────────────────────────────────────────────────

/**
 * A *constructed search* URL containing the wine's own vintage is the
 * dead-link defect: the app asked a shop's literal on-site search for a year
 * it may not stock. Six for six of the reported dead links were this.
 *
 * `is_search_results_page` is load-bearing here, not incidental. A real
 * product page whose slug names its own year — `whwc.com/mangot-st-emilion-2022/`
 * — is *correct*, and Phase 9.1's cross-feed produces exactly those by
 * design. Counting them alongside the constructed searches (which the first
 * version of this function did) reports the fix as incomplete when it isn't:
 * 10 of the 10 remaining hits on the post-fix run were product pages.
 */
function deadLinkCount(entry: SnapshotEntry): number {
  if (entry.vintage === null) return 0
  const year = String(entry.vintage)
  return (entry.price_data?.retailers ?? []).filter(
    r => r.is_search_results_page && r.url.includes(year)
  ).length
}

/** Scores stored against a page whose producer isn't this wine's — the
 * Château Lafleur / Château Grand Village failure. Recomputed from the
 * stored product_url rather than trusted from the stored verdict, so a
 * "before" snapshot (which has no verdict) can be measured the same way. */
function wrongProducerScores(entry: SnapshotEntry): number {
  if (!entry.producer) return 0
  const wine = {
    producer: entry.producer,
    denomination: entry.denomination ?? '',
    vintage: entry.vintage,
  }
  return (entry.review_data ?? [])
    .filter(r => scoreMatch({ title: r.product_url, url: r.product_url }, wine).producer === 'mismatch')
    .reduce((n, r) => n + r.critic_scores.length, 0)
}

function scoreCount(entry: SnapshotEntry): number {
  return (entry.review_data ?? []).reduce((n, r) => n + r.critic_scores.length, 0)
}

/** Stored scores whose result records a vintage verdict at all. Zero for any
 * "before" entry by construction — the field didn't exist — which is the
 * point: it is the single number that says the wrong-vintage class is now
 * even visible. */
function scoresWithVintageVerdict(entry: SnapshotEntry): number {
  return (entry.review_data ?? [])
    .filter(r => r.match !== undefined && r.match !== null)
    .reduce((n, r) => n + r.critic_scores.length, 0)
}

function commandDiff(beforePath: string, datePrefix: string): void {
  const before = parseJson<Snapshot>(fs.existsSync(beforePath) ? fs.readFileSync(beforePath, 'utf-8') : null)
  if (!before) {
    console.error(`No usable snapshot at ${beforePath}.`)
    process.exit(1)
  }

  const beforeById = new Map(before.wines.map(w => [w.id, w]))
  const after = readWines()
    .filter(w => (w.date_added ?? '').startsWith(datePrefix))
    .map(toEntry)

  const totals = {
    retailersBefore: 0, retailersAfter: 0,
    scoresBefore: 0, scoresAfter: 0,
    deadBefore: 0, deadAfter: 0,
    wrongProducerBefore: 0, wrongProducerAfter: 0,
    verdictAfter: 0,
  }

  console.log(`Before/after for ${after.length} wines added ${datePrefix}\n`)

  for (const a of after) {
    const b = beforeById.get(a.id)
    if (!b) {
      console.log(`${a.label}\n  (not in snapshot — skipped)\n`)
      continue
    }

    const rb = b.price_data?.retailers.length ?? 0
    const ra = a.price_data?.retailers.length ?? 0
    const sb = scoreCount(b)
    const sa = scoreCount(a)
    const db_ = deadLinkCount(b)
    const da = deadLinkCount(a)
    const wb = wrongProducerScores(b)
    const wa = wrongProducerScores(a)
    const va = scoresWithVintageVerdict(a)

    totals.retailersBefore += rb; totals.retailersAfter += ra
    totals.scoresBefore += sb; totals.scoresAfter += sa
    totals.deadBefore += db_; totals.deadAfter += da
    totals.wrongProducerBefore += wb; totals.wrongProducerAfter += wa
    totals.verdictAfter += va

    console.log(a.label)
    console.log(`  retailers        ${rb} → ${ra}`)
    console.log(`  critic scores    ${sb} → ${sa}`)
    if (db_ || da) console.log(`  vintage in URL   ${db_} → ${da}`)
    if (wb || wa) console.log(`  wrong producer   ${wb} → ${wa}`)
    for (const r of a.review_data ?? []) {
      const gap = r.vintage_gap
      const note = gap === null || gap === undefined ? 'vintage unknown' : gap === 0 ? 'exact vintage' : `${gap} year(s) off (page ${r.page_vintage})`
      console.log(`    ${r.slug}: ${r.critic_scores.length} score(s), ${note}`)
    }
    console.log()
  }

  console.log('─'.repeat(60))
  console.log(`retailers listed:            ${totals.retailersBefore} → ${totals.retailersAfter}`)
  console.log(`critic scores stored:        ${totals.scoresBefore} → ${totals.scoresAfter}`)
  console.log(`retailer URLs with a vintage: ${totals.deadBefore} → ${totals.deadAfter}   (target: 0)`)
  console.log(`scores on a wrong producer:  ${totals.wrongProducerBefore} → ${totals.wrongProducerAfter}   (target: 0)`)
  console.log(`scores carrying a vintage verdict: 0 → ${totals.verdictAfter}   (the field did not exist before)`)
}

// ─── entry point ─────────────────────────────────────────────────────────────

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function main(): void {
  const command = process.argv[2]
  switch (command) {
    case 'snapshot':
      return commandSnapshot(path.resolve(flag('out', DEFAULT_SNAPSHOT)))
    case 'purge':
      return commandPurge(flag('date', DEFAULT_DATE), path.resolve(flag('before', DEFAULT_SNAPSHOT)), process.argv.includes('--yes'))
    case 'diff':
      return commandDiff(path.resolve(flag('before', DEFAULT_SNAPSHOT)), flag('date', DEFAULT_DATE))
    default:
      console.error('Usage: snapshot-enrichment.ts <snapshot | purge | diff> [--date YYYY-MM-DD] [--before <path>] [--out <path>] [--yes]')
      process.exit(1)
  }
}

main()
