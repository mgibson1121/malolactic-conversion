-- Wine app SQLite schema
-- Phase 5: replaces Google Sheets adapter
-- All boolean tags stored as INTEGER (0/1); JSON arrays stored as TEXT.

CREATE TABLE IF NOT EXISTS wines (
  id                      TEXT PRIMARY KEY,
  producer                TEXT,
  denomination            TEXT,
  vintage                 INTEGER,
  region                  TEXT,
  appellation             TEXT,
  quality_classification  TEXT,
  vineyard                TEXT,
  cuvee                   TEXT,
  grape_varieties         TEXT,    -- JSON array string
  label_image_url         TEXT,
  tag_discovered          INTEGER NOT NULL DEFAULT 1,
  tag_wishlist            INTEGER NOT NULL DEFAULT 0,
  tag_cellar              INTEGER NOT NULL DEFAULT 0,
  tag_consumed            INTEGER NOT NULL DEFAULT 0,
  cellar_category         TEXT,
  cellar_quantity         INTEGER NOT NULL DEFAULT 0,
  drinking_window_start   TEXT,    -- ISO date YYYY-MM-DD
  drinking_window_end     TEXT,    -- ISO date YYYY-MM-DD
  vintage_rating          TEXT,
  my_rating               TEXT,
  my_tags                 TEXT,    -- JSON array string
  latest_tasting_note_id  TEXT,    -- FK → tasting_notes.id; nullable
  wishlist_notes          TEXT,
  price_paid              REAL,
  purchased_from          TEXT,
  advice_linked           TEXT,    -- JSON array of advice UUIDs
  expert_reviews          TEXT,    -- JSON array of ExpertReview objects
  community_sentiment     TEXT,
  community_excerpts      TEXT,    -- JSON array of strings
  price_data              TEXT,    -- JSON PriceData object
  date_added              TEXT NOT NULL,
  date_first_consumed     TEXT     -- ISO timestamp; set once, never overwritten
);

CREATE TABLE IF NOT EXISTS tasting_notes (
  id                          TEXT PRIMARY KEY,
  wine_id                     TEXT NOT NULL REFERENCES wines(id),
  date                        TEXT NOT NULL,   -- ISO timestamp (maps to tasted_at)
  wset_appearance_clarity     TEXT,
  wset_appearance_intensity   TEXT,
  wset_appearance_colour      TEXT,
  wset_nose_condition         TEXT,
  wset_nose_intensity         TEXT,
  wset_nose_primary_aromas    TEXT,   -- JSON array
  wset_nose_secondary_aromas  TEXT,   -- JSON array
  wset_nose_tertiary_aromas   TEXT,   -- JSON array
  wset_palate_sweetness       TEXT,
  wset_palate_acidity         TEXT,
  wset_palate_tannin          TEXT,
  wset_palate_body            TEXT,
  wset_palate_flavour_intensity TEXT,
  wset_palate_finish          TEXT,
  wset_conclusion_quality     TEXT,
  my_rating                   TEXT,
  free_text                   TEXT,
  extracted_tags              TEXT    -- JSON array; from GPT-4o tag extraction
);

CREATE TABLE IF NOT EXISTS advice (
  id          TEXT PRIMARY KEY,
  tip         TEXT NOT NULL,
  source_role TEXT,
  category    TEXT,
  wine_id     TEXT REFERENCES wines(id),
  date_added  TEXT NOT NULL,
  source_name TEXT
);
