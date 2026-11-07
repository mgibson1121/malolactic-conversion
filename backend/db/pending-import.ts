import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

/**
 * Phase 13.1 WI-1: a pending import, applied at container start.
 *
 * The collection reaches production once, as a file uploaded to
 * `<WINE_DB_PATH>.import` (docs/specs/2026-11-03-phase-13.1-data-cutover.md).
 * The live database can't be swapped while the server or Litestream has it
 * open, so `docker-entrypoint.sh` runs this file **before** Litestream starts:
 *
 * 1. no `.import` file: nothing happens;
 * 2. the import must pass `PRAGMA integrity_check` and hold the `wines`,
 *    `tasting_notes` and `app_settings` tables, or it is refused, everything
 *    is left where it was, and the server starts on the current database;
 * 3. the current database and its `-wal`/`-shm` move aside together to
 *    `<db>.pre-import-<timestamp>` (an import never overwrites);
 * 4. the import (with any WAL siblings) moves into place, and the row counts
 *    are logged.
 *
 * The same step puts a point-in-time restore in place (runbook, "Roll back to
 * an earlier moment"). Migrations then run as usual when the server opens the
 * file. The entrypoint resets Litestream's local state after an import, so the
 * backup starts again from the new file rather than from the replaced one.
 *
 * Every step is a rename on the same volume. If the machine stops halfway
 * (old file moved aside, import not yet in place), the `.import` file is still
 * there and the next start finishes the job.
 */

export const SIBLING_SUFFIXES = ['', '-wal', '-shm'] as const
export const REQUIRED_TABLES = ['wines', 'tasting_notes', 'app_settings'] as const

export type ImportCounts = Record<(typeof REQUIRED_TABLES)[number], number>

export type ImportResult =
  | { status: 'none' }
  | { status: 'refused'; reason: string }
  | { status: 'imported'; counts: ImportCounts; previous: string | null }

export interface ImportOptions {
  now?: Date
  log?: (line: string) => void
}

export function importPathFor(dbPath: string): string {
  return `${dbPath}.import`
}

/** `2026-11-07T18-04-05-123Z`: sortable, and safe in a file name. */
function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

function moveWithSiblings(from: string, to: string): void {
  for (const suffix of SIBLING_SUFFIXES) {
    if (fs.existsSync(from + suffix)) fs.renameSync(from + suffix, to + suffix)
  }
}

/** Checks the import file read-only; returns its counts, or why it's refused. */
function inspect(importPath: string): { counts: ImportCounts } | { reason: string } {
  // A read-only open of a WAL-mode file (which `.backup` of the laptop's
  // database is) creates an empty -wal and an -shm beside it. Remove only the
  // ones this check created, so a refusal really leaves everything as it was.
  const preexisting = SIBLING_SUFFIXES.slice(1).filter(s => fs.existsSync(importPath + s))
  try {
    return check(importPath)
  } finally {
    for (const s of SIBLING_SUFFIXES.slice(1)) {
      if (!preexisting.includes(s)) fs.rmSync(importPath + s, { force: true })
    }
  }
}

function check(importPath: string): { counts: ImportCounts } | { reason: string } {
  let db: Database.Database
  try {
    db = new Database(importPath, { readonly: true, fileMustExist: true })
  } catch (err) {
    return { reason: `cannot open it as SQLite (${err instanceof Error ? err.message : String(err)})` }
  }
  try {
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    const result = rows.map(r => r.integrity_check)
    if (result.length !== 1 || result[0] !== 'ok') {
      return { reason: `integrity_check returned: ${result.slice(0, 5).join('; ')}` }
    }
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(r => r.name)
    )
    const missing = REQUIRED_TABLES.filter(t => !tables.has(t))
    if (missing.length > 0) return { reason: `not a wine database; missing table(s): ${missing.join(', ')}` }

    const counts = {} as ImportCounts
    for (const table of REQUIRED_TABLES) {
      counts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    }
    return { counts }
  } catch (err) {
    return { reason: `check failed (${err instanceof Error ? err.message : String(err)})` }
  } finally {
    db.close()
  }
}

export function applyPendingImport(dbPath: string, options: ImportOptions = {}): ImportResult {
  const log = options.log ?? ((line: string) => console.log(line))
  const importPath = importPathFor(dbPath)
  if (!fs.existsSync(importPath)) return { status: 'none' }

  log(`Pending import found: ${importPath}`)
  const checked = inspect(importPath)
  if ('reason' in checked) {
    log(`Import REFUSED, nothing changed; the server starts on the current database: ${checked.reason}`)
    return { status: 'refused', reason: checked.reason }
  }

  let previous: string | null = null
  if (fs.existsSync(dbPath)) {
    previous = `${dbPath}.pre-import-${stamp(options.now ?? new Date())}`
    moveWithSiblings(dbPath, previous)
    log(`Previous database kept as ${previous}`)
  } else {
    // A stray -wal/-shm with no main file would be read as belonging to the
    // imported file. Keep them aside too rather than delete anything.
    const strays = SIBLING_SUFFIXES.slice(1).filter(s => fs.existsSync(dbPath + s))
    if (strays.length > 0) {
      previous = `${dbPath}.pre-import-${stamp(options.now ?? new Date())}`
      moveWithSiblings(dbPath, previous)
      log(`No previous database; leftover ${strays.join(', ')} kept as ${previous}*`)
    } else {
      log('No previous database to keep.')
    }
  }

  moveWithSiblings(importPath, dbPath)
  const { counts } = checked
  log(
    `Imported ${importPath} → ${dbPath}: wines=${counts.wines} tasting_notes=${counts.tasting_notes} app_settings=${counts.app_settings}`
  )
  return { status: 'imported', counts, previous }
}

// `node backend/dist/backend/db/pending-import.js` from docker-entrypoint.sh.
// Exit 0 whether or not anything was imported (a refusal must not stop the
// server from starting on the current database); only an unexpected error,
// such as a failed rename, exits non-zero and stops the start.
if (require.main === module) {
  const dbPath = path.resolve(process.env.WINE_DB_PATH ?? path.resolve(__dirname, 'wine.db'))
  applyPendingImport(dbPath)
}
