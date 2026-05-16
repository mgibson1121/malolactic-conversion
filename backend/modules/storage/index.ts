import { createSheetsClient, SheetsAdapter } from '../../sheets'
import type { SheetsClientInterface } from '../../sheets'
import type { StorageAdapter } from './interface'

function createStorage(): StorageAdapter {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  if (!spreadsheetId) {
    throw new Error(
      'GOOGLE_SHEETS_SPREADSHEET_ID is not set. ' +
        'Create a Google Sheet and copy its ID from the URL.'
    )
  }
  const client = createSheetsClient() as unknown as SheetsClientInterface
  return new SheetsAdapter(client, spreadsheetId)
}

// Lazily initialised so tests can import routes without triggering credential checks.
let _storage: StorageAdapter | null = null

export function getStorage(): StorageAdapter {
  if (!_storage) _storage = createStorage()
  return _storage
}

export type { StorageAdapter } from './interface'
