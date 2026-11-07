import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyPendingImport, importPathFor } from './pending-import'
import { runMigration } from './migrate'

const NOW = new Date('2026-11-07T18:04:05.123Z')
const PREVIOUS = (db: string) => `${db}.pre-import-2026-11-07T18-04-05-123Z`

let dir: string
let dbPath: string
let lines: string[]
const log = (line: string) => lines.push(line)

/** A migrated wine database at `file` holding `wines` rows; returns it open. */
function makeWineDb(file: string, wines: number, keepOpen = false): Database.Database | null {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  runMigration(db)
  const insert = db.prepare("INSERT INTO wines (producer, date_added) VALUES (?, '2026-11-01')")
  for (let i = 0; i < wines; i++) insert.run(`Producer ${file.length}-${i}`)
  if (keepOpen) return db
  db.close()
  return null
}

function countWines(file: string): number {
  const db = new Database(file, { readonly: true })
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM wines').get() as { n: number }).n
  } finally {
    db.close()
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-import-'))
  dbPath = path.join(dir, 'wine.db')
  lines = []
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('applyPendingImport', () => {
  it('does nothing when there is no import file', () => {
    makeWineDb(dbPath, 2)
    const before = fs.readdirSync(dir).sort()

    expect(applyPendingImport(dbPath, { now: NOW, log })).toEqual({ status: 'none' })
    expect(fs.readdirSync(dir).sort()).toEqual(before)
    expect(lines).toEqual([])
    expect(countWines(dbPath)).toBe(2)
  })

  it('refuses an import that fails the integrity check and changes nothing', () => {
    makeWineDb(dbPath, 2)
    makeWineDb(importPathFor(dbPath), 5)
    // Corrupt the import: overwrite the middle of the file, past the header.
    const bytes = fs.readFileSync(importPathFor(dbPath))
    bytes.fill(0xab, 4096, bytes.length)
    fs.writeFileSync(importPathFor(dbPath), bytes)
    const before = fs.readdirSync(dir).sort()

    const result = applyPendingImport(dbPath, { now: NOW, log })

    expect(result.status).toBe('refused')
    expect(fs.readdirSync(dir).sort()).toEqual(before)
    expect(countWines(dbPath)).toBe(2)
    expect(lines.join('\n')).toMatch(/REFUSED/)
  })

  it('refuses a file that is not SQLite at all', () => {
    makeWineDb(dbPath, 1)
    fs.writeFileSync(importPathFor(dbPath), 'not a database')

    const result = applyPendingImport(dbPath, { now: NOW, log })

    expect(result.status).toBe('refused')
    expect(fs.existsSync(importPathFor(dbPath))).toBe(true)
    expect(countWines(dbPath)).toBe(1)
  })

  it('refuses a healthy SQLite file that is not a wine database', () => {
    makeWineDb(dbPath, 1)
    const other = new Database(importPathFor(dbPath))
    other.exec('CREATE TABLE something_else (id INTEGER)')
    other.close()

    const result = applyPendingImport(dbPath, { now: NOW, log })

    expect(result).toEqual({ status: 'refused', reason: expect.stringMatching(/missing table\(s\): wines, tasting_notes, app_settings/) })
    expect(countWines(dbPath)).toBe(1)
  })

  it('imports, keeps the previous database beside it, and logs the counts', () => {
    makeWineDb(dbPath, 2)
    makeWineDb(importPathFor(dbPath), 5)

    const result = applyPendingImport(dbPath, { now: NOW, log })

    expect(result).toEqual({
      status: 'imported',
      counts: { wines: 5, tasting_notes: 0, app_settings: 1 },
      previous: PREVIOUS(dbPath),
    })
    expect(fs.existsSync(importPathFor(dbPath))).toBe(false)
    expect(countWines(dbPath)).toBe(5)
    expect(countWines(PREVIOUS(dbPath))).toBe(2)
    expect(lines.join('\n')).toMatch(/wines=5 tasting_notes=0 app_settings=1/)
  })

  it('moves the WAL siblings together with the previous database', () => {
    // Keep a connection open so the -wal and -shm exist with uncheckpointed
    // writes, as they would if the machine had stopped uncleanly.
    const live = makeWineDb(dbPath, 3, true)!
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(true)
    // Snapshot the three files as they are on disk, then close the writer.
    for (const s of ['', '-wal', '-shm']) fs.copyFileSync(dbPath + s, path.join(dir, `snap${s}`))
    live.close()
    for (const s of ['', '-wal', '-shm']) {
      fs.rmSync(dbPath + s, { force: true })
      fs.renameSync(path.join(dir, `snap${s}`), dbPath + s)
    }
    makeWineDb(importPathFor(dbPath), 4)

    applyPendingImport(dbPath, { now: NOW, log })

    for (const s of ['-wal', '-shm']) {
      expect(fs.existsSync(dbPath + s)).toBe(false)
      expect(fs.existsSync(PREVIOUS(dbPath) + s)).toBe(true)
    }
    // The kept copy still reads its rows from its own WAL.
    expect(countWines(PREVIOUS(dbPath))).toBe(3)
    expect(countWines(dbPath)).toBe(4)
  })

  it('imports onto an empty volume with no previous database', () => {
    makeWineDb(importPathFor(dbPath), 2)

    const result = applyPendingImport(dbPath, { now: NOW, log })

    expect(result).toMatchObject({ status: 'imported', previous: null })
    expect(countWines(dbPath)).toBe(2)
  })

  it('keeps leftover -wal/-shm aside when there is no main database file', () => {
    makeWineDb(importPathFor(dbPath), 2)
    fs.writeFileSync(`${dbPath}-wal`, 'stale')

    const result = applyPendingImport(dbPath, { now: NOW, log })

    expect(result).toMatchObject({ status: 'imported', previous: PREVIOUS(dbPath) })
    expect(fs.readFileSync(`${PREVIOUS(dbPath)}-wal`, 'utf8')).toBe('stale')
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false)
    expect(countWines(dbPath)).toBe(2)
  })

  it('finishes an import that stopped after the old file was moved aside', () => {
    makeWineDb(importPathFor(dbPath), 3)
    // Simulate: previous database already renamed away, import still pending.
    expect(fs.existsSync(dbPath)).toBe(false)

    expect(applyPendingImport(dbPath, { now: NOW, log }).status).toBe('imported')
    expect(countWines(dbPath)).toBe(3)
  })
})
