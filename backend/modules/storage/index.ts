import { openDatabase } from '../../db/migrate'
import { SQLiteAdapter } from './sqlite-adapter'
import type { StorageAdapter } from './interface'

// Single database connection shared across the process lifetime.
let _storage: StorageAdapter | null = null

export function getStorage(): StorageAdapter {
  if (!_storage) {
    const db = openDatabase()
    _storage = new SQLiteAdapter(db)
  }
  return _storage
}

export type { StorageAdapter } from './interface'
