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
 * Applies ALTER TABLE migrations from the migrations/ directory.
 * Each .sql file is run statement-by-statement; statements that fail because
 * the column already exists (SQLITE_ERROR "duplicate column name") are silently
 * skipped — all other errors are re-thrown.
 */
function runAlterMigrations(db: Database.Database): void {
  if (!fs.existsSync(MIGRATIONS_DIR)) return

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
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
        if (msg.includes('duplicate column name')) continue
        throw err
      }
    }
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
