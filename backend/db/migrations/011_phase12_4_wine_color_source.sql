-- Phase 12.4 (WI-6): where a wine's colour came from, so an inferred colour
-- carries the Sourced marker and is never mistaken for one read off the label.
--
-- 'derived' — inferred from the wine's identity for an imported wine with no
-- label (scripts/infer-wine-color.ts --apply, from a reviewed proposals file).
-- 'manual'  — set by the developer in Edit.
-- NULL      — unknown provenance: every colour stored before this migration
--             (label scan or typed in), and a wine created since.
--
-- Inference only ever fills a NULL colour, so neither a manual nor a scanned
-- colour can be overwritten by it.

ALTER TABLE wines ADD COLUMN wine_color_source TEXT;
