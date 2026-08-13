-- Phase 9.2: per-retailer negative probe log for review sourcing
-- A retailer that returned zero_results for a specific bottling burns the
-- full query-variant ladder every run to learn the same thing again. This
-- column records the last outcome per retailer per wine so a subsequent
-- fetch-reviews run can skip a shop known not to carry this bottling,
-- without ever skipping on request_failed (a transient failure must never
-- be read as a negative result — see the 2026-08-05 data-loss incident this
-- pipeline is built around not repeating).
-- JSON array of { slug, domain, stage, variants_tried, probed_at }.

ALTER TABLE wines ADD COLUMN review_probe_log TEXT;
