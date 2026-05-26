import Database from 'better-sqlite3'
import { runMigration } from './migrate'

describe('runMigration', () => {
  it('creates wines, tasting_notes, and advice tables on a fresh database', () => {
    const db = new Database(':memory:')
    runMigration(db)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]

    const names = tables.map((t) => t.name)
    expect(names).toContain('wines')
    expect(names).toContain('tasting_notes')
    expect(names).toContain('advice')

    db.close()
  })

  it('is idempotent — safe to run multiple times without error', () => {
    const db = new Database(':memory:')
    expect(() => {
      runMigration(db)
      runMigration(db)
      runMigration(db)
    }).not.toThrow()
    db.close()
  })

  it('wines table has required columns', () => {
    const db = new Database(':memory:')
    runMigration(db)

    const columns = db
      .prepare('PRAGMA table_info(wines)')
      .all() as { name: string }[]
    const colNames = columns.map((c) => c.name)

    const required = [
      'id', 'producer', 'denomination', 'vintage', 'region',
      'tag_discovered', 'tag_wishlist', 'tag_cellar', 'tag_consumed',
      'cellar_quantity', 'latest_tasting_note_id', 'date_added',
    ]
    for (const col of required) {
      expect(colNames).toContain(col)
    }

    db.close()
  })

  it('tasting_notes table has required columns', () => {
    const db = new Database(':memory:')
    runMigration(db)

    const columns = db
      .prepare('PRAGMA table_info(tasting_notes)')
      .all() as { name: string }[]
    const colNames = columns.map((c) => c.name)

    const required = ['id', 'wine_id', 'date', 'my_rating', 'extracted_tags']
    for (const col of required) {
      expect(colNames).toContain(col)
    }

    db.close()
  })

  it('sets default values correctly', () => {
    const db = new Database(':memory:')
    runMigration(db)

    db.prepare(`
      INSERT INTO wines (id, date_added) VALUES ('test-id', '2026-01-01T00:00:00.000Z')
    `).run()

    const row = db.prepare('SELECT * FROM wines WHERE id = ?').get('test-id') as {
      tag_discovered: number
      tag_wishlist: number
      tag_cellar: number
      tag_consumed: number
      cellar_quantity: number
    }

    expect(row.tag_discovered).toBe(1)
    expect(row.tag_wishlist).toBe(0)
    expect(row.tag_cellar).toBe(0)
    expect(row.tag_consumed).toBe(0)
    expect(row.cellar_quantity).toBe(0)

    db.close()
  })
})
