import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

// `WINE_DB_PATH` points the backend at another database file — a copy of the
// real one, to try a build against real-shaped data without touching (or
// spending metered calls on) the developer's collection. Unset in normal use.
const DB_PATH = process.env.WINE_DB_PATH ? path.resolve(process.env.WINE_DB_PATH) : path.resolve(__dirname, 'wine.db')
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql')
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations')

/**
 * Runs the base schema SQL against the given database.
 * All CREATE TABLE statements use IF NOT EXISTS — safe to call multiple times.
 */
export function runMigration(db: Database.Database): void {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf-8')
  db.exec(sql)
  runAlterMigrations(db)
}

/**
 * Applies the migrations/ directory, each file once.
 *
 * Until 2026-10-05 every file re-ran on every start, relying on "duplicate
 * column name" errors to make that harmless. It wasn't: 005's backfill
 * `UPDATE wines SET promoted_at = date_added WHERE promoted_at IS NULL` ran
 * again each time, so every backend restart silently turned every unsaved
 * draft into a saved wine — usually with no list at all (found when a
 * Cornas whose save had failed reappeared as saved, in no list).
 *
 * Now: `schema_migrations` records each applied file, and a recorded file
 * is skipped. A database migrated before that table existed has no record,
 * so a file whose ADD COLUMN reports the column already exists is taken as
 * applied: recorded, and the rest of it — the backfill — skipped. Only a
 * file that has never run gets its data statements.
 */
function runAlterMigrations(db: Database.Database): void {
  if (!fs.existsSync(MIGRATIONS_DIR)) return

  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map(r => r.name)
  )
  const record = db.prepare('INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)')

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  const pending = files.filter(f => !applied.has(f))
  if (pending.length > 0) backupBeforeMigrating(db, pending)

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    const statements = sql
      .split(';')
      .map(s => s.replace(/--[^\n]*/g, '').trim())
      .filter(Boolean)

    // One transaction per file (2026-10-10, Phase 12.1): 008 rebuilds a
    // table (create, copy, drop, rename), and a crash between the drop and the
    // rename must not leave the database without its notes table. SQLite DDL
    // is transactional. A statement error inside a transaction does not abort
    // it, so the "duplicate column name" break below still just stops early.
    db.exec('BEGIN')
    try {
      for (const stmt of statements) {
        try {
          db.exec(stmt)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          // The column is already there: this file ran before migrations
          // were recorded. Don't run its remaining statements again.
          if (msg.includes('duplicate column name')) break
          throw err
        }
      }
      record.run(file, new Date().toISOString())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

/**
 * Copies the database beside itself before any migration touches it (Phase 13
 * WI-4, spec R6: Phase 12 had a migration re-run bug that turned drafts into
 * saved wines, and on the cloud machine nobody would see it happen). Runs
 * only when a migration is about to apply to a database that already holds
 * wines, so a fresh or in-memory database (tests) gets no copy.
 *
 * `VACUUM INTO` writes one consistent file that includes whatever is still in
 * the WAL (spec R7). The copy stays on the same volume as
 * `<db>.pre-migrate-<timestamp>` for an immediate rollback; the off-machine
 * history is Litestream's (docs/ops/runbook.md, "Backup and restore").
 */
function backupBeforeMigrating(db: Database.Database, pending: string[]): void {
  if (db.memory) return
  const hasWines = db.prepare('SELECT EXISTS (SELECT 1 FROM wines) AS present').get() as { present: number }
  if (!hasWines.present) return
  const target = `${db.name}.pre-migrate-${new Date().toISOString().replace(/[:.]/g, '-')}`
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  console.log(`Copied the database before migrating (${pending.join(', ')}): ${target}`)
}

/**
 * Opens (or creates) the production database and runs migrations.
 * Returns the open database handle.
 */
export function openDatabase(): Database.Database {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  runMigration(db)
  return db
}

if (require.main === module) {
  const db = openDatabase()
  console.log(`Migration complete. Database at: ${DB_PATH}`)
  db.close()
}
