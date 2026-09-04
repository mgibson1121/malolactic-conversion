-- Phase 10.5: wine color
-- Tier 2 field, same nullable-by-design treatment as quality_classification —
-- no provenance tracking (unlike drinking_window_source/vintage_rating_source):
-- nothing auto-derives this beyond a one-time label-scan extraction, and a
-- manual PATCH is expected to simply overwrite it, same as quality_classification.
-- Values: 'red' | 'white' | 'rosé' | NULL (unset). Enum validity is enforced in
-- shared/validation.ts only, not in SQL — matching every other enum-shaped
-- TEXT column in this table.

ALTER TABLE wines ADD COLUMN wine_color TEXT;
