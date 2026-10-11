-- Phase 12.1 (WI-3): tasting notes outlive the wine.
--
-- A note is a record of something the developer tasted, deleting the wine it
-- was written about must not delete it, or be blocked by it. So tasting_notes
-- gets a nullable wine_id (ON DELETE SET NULL) and carries its own snapshot
-- of the wine's identity, copied at save time.
--
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt. The runner
-- executes a migration file in one transaction (db/migrate.ts), so a failure
-- part-way leaves the old table untouched. Existing rows are backfilled from
-- the wine each one currently points at.

DROP TABLE IF EXISTS tasting_notes_new;

CREATE TABLE tasting_notes_new (
  id                          TEXT PRIMARY KEY,
  wine_id                     TEXT REFERENCES wines(id) ON DELETE SET NULL,
  date                        TEXT NOT NULL,
  wset_appearance_clarity     TEXT,
  wset_appearance_intensity   TEXT,
  wset_appearance_colour      TEXT,
  wset_nose_condition         TEXT,
  wset_nose_intensity         TEXT,
  wset_nose_primary_aromas    TEXT,
  wset_nose_secondary_aromas  TEXT,
  wset_nose_tertiary_aromas   TEXT,
  wset_palate_sweetness       TEXT,
  wset_palate_acidity         TEXT,
  wset_palate_tannin          TEXT,
  wset_palate_body            TEXT,
  wset_palate_flavour_intensity TEXT,
  wset_palate_finish          TEXT,
  wset_conclusion_quality     TEXT,
  my_rating                   TEXT,
  free_text                   TEXT,
  extracted_tags              TEXT,
  wine_producer               TEXT,
  wine_denomination           TEXT,
  wine_vintage                INTEGER,
  wine_vineyard               TEXT,
  wine_cuvee                  TEXT
);

INSERT INTO tasting_notes_new (
  id, wine_id, date,
  wset_appearance_clarity, wset_appearance_intensity, wset_appearance_colour,
  wset_nose_condition, wset_nose_intensity,
  wset_nose_primary_aromas, wset_nose_secondary_aromas, wset_nose_tertiary_aromas,
  wset_palate_sweetness, wset_palate_acidity, wset_palate_tannin,
  wset_palate_body, wset_palate_flavour_intensity, wset_palate_finish,
  wset_conclusion_quality, my_rating, free_text, extracted_tags,
  wine_producer, wine_denomination, wine_vintage, wine_vineyard, wine_cuvee
)
SELECT
  n.id, n.wine_id, n.date,
  n.wset_appearance_clarity, n.wset_appearance_intensity, n.wset_appearance_colour,
  n.wset_nose_condition, n.wset_nose_intensity,
  n.wset_nose_primary_aromas, n.wset_nose_secondary_aromas, n.wset_nose_tertiary_aromas,
  n.wset_palate_sweetness, n.wset_palate_acidity, n.wset_palate_tannin,
  n.wset_palate_body, n.wset_palate_flavour_intensity, n.wset_palate_finish,
  n.wset_conclusion_quality, n.my_rating, n.free_text, n.extracted_tags,
  w.producer, w.denomination, w.vintage, w.vineyard, w.cuvee
FROM tasting_notes n LEFT JOIN wines w ON w.id = n.wine_id;

DROP TABLE tasting_notes;

ALTER TABLE tasting_notes_new RENAME TO tasting_notes;

CREATE INDEX IF NOT EXISTS idx_tasting_notes_wine_id ON tasting_notes(wine_id);
