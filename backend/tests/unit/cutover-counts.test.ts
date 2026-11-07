import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { runMigration } from '../../db/migrate'
import { compare, countWines, formatTable, readLaptop, readProduction } from '../../scripts/cutover-counts'

const NOW = new Date('2026-11-07T12:00:00.000Z')
const wine = (id: string, promoted: boolean, dateAdded = '2026-11-07T11:00:00.000Z') => ({
  id,
  promoted_at: promoted ? dateAdded : null,
  date_added: dateAdded,
})

describe('countWines', () => {
  it('splits promoted wines from drafts, and leaves out drafts the 24-hour sweep removes', () => {
    const counts = countWines(
      [wine('b', true), wine('a', true, '2025-01-01T00:00:00.000Z'), wine('d1', false), wine('d2', false, '2026-11-05T00:00:00.000Z')],
      3,
      120,
      NOW
    )
    expect(counts).toEqual({
      wines: 3,
      promoted: 2,
      drafts: 1,
      tastingNotes: 3,
      cellarCapacity: 120,
      promotedIds: ['a', 'b'],
      staleDrafts: 1,
    })
  })

  it('counts every draft when no cutoff is given (production has already swept)', () => {
    expect(countWines([wine('d', false, '2020-01-01T00:00:00.000Z')], 0, null).drafts).toBe(1)
  })
})

describe('compare', () => {
  const laptop = { ...countWines([wine('a', true), wine('b', true), wine('d', false)], 2, null, NOW) }
  const { staleDrafts: _s, ...same } = laptop

  it('matches every row when production holds the same collection', () => {
    const rows = compare(laptop, same)
    expect(rows.every(r => r.match)).toBe(true)
    expect(formatTable(rows)).not.toMatch(/MISMATCH/)
  })

  it('flags a different set of promoted wines even when the counts agree', () => {
    const rows = compare(laptop, { ...same, promotedIds: ['a', 'z'] })
    expect(rows.filter(r => !r.match).map(r => r.label)).toEqual(['Promoted wine ids'])
    expect(formatTable(rows)).toMatch(/Promoted wine ids .* DIFFERENT\s+MISMATCH/)
  })

  it('flags a missing tasting note and a changed setting', () => {
    const rows = compare(laptop, { ...same, tastingNotes: 1, cellarCapacity: 50 })
    expect(rows.filter(r => !r.match).map(r => r.label)).toEqual(['Tasting notes', 'Settings: cellar capacity'])
  })
})

describe('readLaptop', () => {
  it('reads counts from a real database file without changing it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-counts-'))
    const file = path.join(dir, 'copy.db')
    try {
      const db = new Database(file)
      runMigration(db)
      const insert = db.prepare('INSERT INTO wines (id, producer, date_added, promoted_at) VALUES (?, ?, ?, ?)')
      insert.run('w1', 'A', '2026-11-01', '2026-11-01')
      insert.run('w2', 'B', '2026-11-07T11:30:00.000Z', null)
      insert.run('w3', 'C', '2026-10-01', null)
      db.prepare('UPDATE app_settings SET cellar_capacity = 200 WHERE id = 1').run()
      db.close()
      const before = fs.readFileSync(file)

      expect(readLaptop(file, NOW)).toMatchObject({ wines: 2, promoted: 1, drafts: 1, staleDrafts: 1, cellarCapacity: 200, promotedIds: ['w1'] })
      expect(fs.readFileSync(file).equals(before)).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('readProduction', () => {
  const respond = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: async () => body }) as unknown as Response

  it('reads the three routes with the key as a bearer token', async () => {
    const calls: Array<{ url: string; auth: string }> = []
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string>).Authorization })
      if (url.endsWith('/api/wines?include_drafts=true')) return respond([wine('a', true), wine('d', false, '2020-01-01')])
      if (url.endsWith('/api/tasting-notes')) return respond([{}, {}])
      return respond({ cellar_capacity: 90 })
    }) as unknown as typeof fetch

    const counts = await readProduction('https://example.test/', 'k'.repeat(40), fake)

    expect(counts).toEqual({ wines: 2, promoted: 1, drafts: 1, tastingNotes: 2, cellarCapacity: 90, promotedIds: ['a'] })
    expect(calls.map(c => c.url).sort()).toEqual([
      'https://example.test/api/settings',
      'https://example.test/api/tasting-notes',
      'https://example.test/api/wines?include_drafts=true',
    ])
    expect(calls.every(c => c.auth === `Bearer ${'k'.repeat(40)}`)).toBe(true)
  })

  it('explains a refused key', async () => {
    const fake = (async () => respond({}, 401)) as unknown as typeof fetch
    await expect(readProduction('https://example.test', 'bad', fake)).rejects.toThrow(/401 .*WINE_ACCESS_KEY/)
  })
})
