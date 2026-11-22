-- Phase 14 (WI-1): a wine's metered lookups as persisted jobs.
--
-- JSON, one section per kind: {"reviews": {state, stage, started_at,
-- updated_at, shops_total, shops_done, scores_found, identity}, "price": {...}}.
-- NULL means no lookup has run since this migration. Written only by the
-- server (routes/enrichment-jobs.ts) and read by clients to show a search that
-- is still running, including after the scan screen that started it is gone.
--
-- Additive and nullable, so a build from before this migration ignores the
-- column (the old TestFlight build decodes by key and never sees it).
-- Keep semicolons out of these comments: migrate.ts splits statements on them.

ALTER TABLE wines ADD COLUMN enrichment_job TEXT;
