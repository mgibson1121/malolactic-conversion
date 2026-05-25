import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const DB_PATH = path.resolve(__dirname, 'wine.db')
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql')

/**
 * Runs the schema SQL against the given database.
 * All CREATE TABLE statements use IF NOT EXISTS — safe to call multiple times.
 */
export function runMigration(db: Database.Database): void {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf-8')
  db.exec(sql)
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
