import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const DB_PATH = path.resolve(__dirname, 'wine.db')
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

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    const statements = sql
      .split(';')
      .map(s => s.replace(/--[^\n]*/g, '').trim())
      .filter(Boolean)

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
  }
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
