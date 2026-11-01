import type Database from 'better-sqlite3'
import { openDatabase } from '../../db/migrate'
import { SQLiteAdapter } from './sqlite-adapter'
import type { StorageAdapter } from './interface'

// Single database connection shared across the process lifetime.
let _db: Database.Database | null = null
let _storage: StorageAdapter | null = null

export function getStorage(): StorageAdapter {
  if (!_storage) {
    _db = openDatabase()
    _storage = new SQLiteAdapter(_db)
  }
  return _storage
}

/**
 * Folds the write-ahead log back into the database file and closes it
 * (Phase 13 WI-1, graceful shutdown). A machine stopped with the WAL still
 * holding recent writes keeps them — SQLite replays it on the next open — but
 * a backup or copy of the `.db` alone would not (spec R7), so leave the file
 * whole. No-op if the database was never opened.
 */
export function closeStorage(): void {
  if (!_db) return
  _db.pragma('wal_checkpoint(TRUNCATE)')
  _db.close()
  _db = null
  _storage = null
}

export type { StorageAdapter } from './interface'
