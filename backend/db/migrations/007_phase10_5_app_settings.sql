-- Phase 10.5: app-level settings
-- A single-row config table for app-wide (not per-wine) values — currently
-- just cellar_capacity, a user-set total bottle-slot count the Cellar tab's
-- "capacity used" stat divides into. Singleton enforced via the CHECK
-- constraint on id, same spirit as the wines/tasting_notes/advice tables in
-- schema.sql but new here since no KV/settings table existed before this.

CREATE TABLE IF NOT EXISTS app_settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  cellar_capacity  INTEGER
);

INSERT OR IGNORE INTO app_settings (id, cellar_capacity) VALUES (1, NULL);
