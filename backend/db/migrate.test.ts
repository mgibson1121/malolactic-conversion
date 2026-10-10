import Database from 'better-sqlite3'
import { runMigration } from './migrate'
import fs from 'fs'
import path from 'path'

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
    expect(names).toContain('app_settings')

    db.close()
  })

  it('seeds a single app_settings row with cellar_capacity unset', () => {
    const db = new Database(':memory:')
    runMigration(db)

    const rows = db.prepare('SELECT * FROM app_settings').all() as {
      id: number
      cellar_capacity: number | null
    }[]

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(1)
    expect(rows[0].cellar_capacity).toBeNull()

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
      'cellar_quantity', 'latest_tasting_note_id', 'date_added', 'wine_color',
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

    // Phase 9.4: not auto-set; every insert path supplies an explicit value.
    // schema.sql's column DEFAULT was corrected from 1 to 0 in Phase 11 to
    // match — this test previously asserted the stale default.
    expect(row.tag_discovered).toBe(0)
    expect(row.tag_wishlist).toBe(0)
    expect(row.tag_cellar).toBe(0)
    expect(row.tag_consumed).toBe(0)
    expect(row.cellar_quantity).toBe(0)

    db.close()
  })
})

const SCHEMA = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8')
const MIGRATIONS = fs.readdirSync(path.resolve(__dirname, 'migrations')).filter(f => f.endsWith('.sql')).sort()

function insertDraft(db: Database.Database, id: string): void {
  db.prepare('INSERT INTO wines (id, date_added, promoted_at) VALUES (?, ?, NULL)').run(id, '2026-10-05T00:17:54.016Z')
}
const promotedAt = (db: Database.Database, id: string) =>
  (db.prepare('SELECT promoted_at FROM wines WHERE id = ?').get(id) as { promoted_at: string | null }).promoted_at

// 2026-10-05 — every backend start re-ran 005's backfill and turned every
// unsaved draft into a saved wine with no list.
describe('runMigration — each migration runs once', () => {
  it('a restart leaves a draft a draft', () => {
    const db = new Database(':memory:')
    runMigration(db)
    insertDraft(db, 'cornas')
    runMigration(db)
    runMigration(db)
    expect(promotedAt(db, 'cornas')).toBeNull()
  })

  it('records every applied file', () => {
    const db = new Database(':memory:')
    runMigration(db)
    const names = (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as Array<{ name: string }>).map(r => r.name)
    expect(names).toEqual(MIGRATIONS)
  })

  it('a database migrated before files were recorded does not re-run the backfill', () => {
    const db = new Database(':memory:')
    runMigration(db)
    db.exec('DROP TABLE schema_migrations') // as the old runner left it
    insertDraft(db, 'cornas')
    runMigration(db)
    expect(promotedAt(db, 'cornas')).toBeNull()
    expect((db.prepare('SELECT COUNT(*) n FROM schema_migrations').get() as { n: number }).n).toBe(MIGRATIONS.length)
  })

  it('a migration that never ran still gets its backfill, once', () => {
    // A pre-Phase-9.4 database: no promoted_at column yet, one legacy wine.
    const db = new Database(':memory:')
    db.exec(SCHEMA)
    db.prepare('INSERT INTO wines (id, date_added) VALUES (?, ?)').run('legacy', '2026-05-25T23:04:17.769Z')
    runMigration(db)
    expect(promotedAt(db, 'legacy')).toBe('2026-05-25T23:04:17.769Z')
  })
})

// ─── Phase 12.1: migrations 008 / 009 against an existing database ───────────

describe('migration 008 — tasting notes outlive the wine (Phase 12.1)', () => {
  /** A database exactly as it was before 008: the old NOT NULL tasting_notes. */
  function legacyDb(): Database.Database {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE wines (id TEXT PRIMARY KEY, producer TEXT, denomination TEXT, vintage INTEGER,
        vineyard TEXT, cuvee TEXT, date_added TEXT NOT NULL);
      CREATE TABLE tasting_notes (
        id TEXT PRIMARY KEY,
        wine_id TEXT NOT NULL REFERENCES wines(id),
        date TEXT NOT NULL,
        my_rating TEXT, free_text TEXT, extracted_tags TEXT
      );
      INSERT INTO wines VALUES ('w1', 'Roumier', 'Bonnes-Mares', 2018, NULL, NULL, '2026-01-01');
      INSERT INTO tasting_notes VALUES ('n1', 'w1', '2026-02-01', 'good', 'Lovely', '[]');
    `)
    return db
  }

  it('rebuilds the table, keeps every row, and backfills the snapshot from the wine', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    // Bring a real-shaped legacy database up through the runner.
    runMigration(db)
    // Rewind to the pre-008 shape, then run the runner again.
    db.exec(`
      DROP TABLE tasting_notes;
      CREATE TABLE tasting_notes (
        id TEXT PRIMARY KEY, wine_id TEXT NOT NULL REFERENCES wines(id), date TEXT NOT NULL,
        wset_appearance_clarity TEXT, wset_appearance_intensity TEXT, wset_appearance_colour TEXT,
        wset_nose_condition TEXT, wset_nose_intensity TEXT, wset_nose_primary_aromas TEXT,
        wset_nose_secondary_aromas TEXT, wset_nose_tertiary_aromas TEXT, wset_palate_sweetness TEXT,
        wset_palate_acidity TEXT, wset_palate_tannin TEXT, wset_palate_body TEXT,
        wset_palate_flavour_intensity TEXT, wset_palate_finish TEXT, wset_conclusion_quality TEXT,
        my_rating TEXT, free_text TEXT, extracted_tags TEXT
      );
      DELETE FROM schema_migrations WHERE name = '008_phase12_1_notes_independent.sql';
      INSERT INTO wines (id, producer, denomination, vintage, vineyard, cuvee, date_added, cellar_quantity)
        VALUES ('w1', 'Roumier', 'Bonnes-Mares', 2018, 'V', 'C', '2026-01-01', 0);
      INSERT INTO tasting_notes (id, wine_id, date, my_rating, free_text, extracted_tags)
        VALUES ('n1', 'w1', '2026-02-01', 'good', 'Lovely', '[]');
    `)

    runMigration(db)

    const note = db.prepare('SELECT * FROM tasting_notes WHERE id = ?').get('n1') as Record<string, unknown>
    expect(note).toMatchObject({
      wine_id: 'w1', free_text: 'Lovely', my_rating: 'good',
      wine_producer: 'Roumier', wine_denomination: 'Bonnes-Mares', wine_vintage: 2018,
      wine_vineyard: 'V', wine_cuvee: 'C',
    })
    const cols = db.prepare('PRAGMA table_info(tasting_notes)').all() as { name: string; notnull: number }[]
    expect(cols.find((c) => c.name === 'wine_id')!.notnull).toBe(0)

    // The point of the migration: deleting the wine no longer touches the note.
    db.prepare('DELETE FROM wines WHERE id = ?').run('w1')
    const kept = db.prepare('SELECT wine_id, wine_producer FROM tasting_notes WHERE id = ?').get('n1')
    expect(kept).toEqual({ wine_id: null, wine_producer: 'Roumier' })
    db.close()
  })

  it('runs once: a second start does not rebuild the table or lose data', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigration(db)
    db.prepare(`INSERT INTO wines (id, producer, date_added, cellar_quantity) VALUES ('w', 'P', '2026-01-01', 0)`).run()
    db.prepare(`INSERT INTO tasting_notes (id, wine_id, date) VALUES ('n', 'w', '2026-02-01')`).run()
    runMigration(db)
    runMigration(db)
    expect(db.prepare('SELECT COUNT(*) AS c FROM tasting_notes').get()).toEqual({ c: 1 })
    db.close()
  })

  it('rolls the whole file back if a statement fails, leaving the old table in place', () => {
    const db = legacyDb()
    // This skeletal legacy table lacks the WSET columns the file's copy step
    // selects, so the statement fails after the new table was already created.
    expect(() => runMigration(db)).toThrow(/no such column/)
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name)
    expect(names).toContain('tasting_notes')
    expect(names).not.toContain('tasting_notes_new')
    expect(db.prepare('SELECT COUNT(*) AS c FROM tasting_notes').get()).toEqual({ c: 1 })
    db.close()
  })
})

describe('migration 009 — manual_price (Phase 12.1)', () => {
  it('adds a nullable manual_price column, null for existing wines', () => {
    const db = new Database(':memory:')
    runMigration(db)
    const col = (db.prepare('PRAGMA table_info(wines)').all() as { name: string; notnull: number }[]).find(
      (c) => c.name === 'manual_price'
    )
    expect(col).toBeDefined()
    expect(col!.notnull).toBe(0)
    db.close()
  })
})
