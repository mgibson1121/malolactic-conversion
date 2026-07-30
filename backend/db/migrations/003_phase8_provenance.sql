-- Phase 8: drinking window / vintage rating provenance
-- Tracks whether drinking_window_start/end and vintage_rating were set
-- manually by the developer or derived from review extraction, so a later
-- automated run never silently overwrites a manually-set value.
-- Values: 'manual' | 'derived' | NULL (neither has happened yet).

ALTER TABLE wines ADD COLUMN drinking_window_source TEXT;
ALTER TABLE wines ADD COLUMN vintage_rating_source TEXT;
