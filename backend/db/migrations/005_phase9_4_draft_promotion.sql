-- Phase 9.4: draft/promotion model
-- NULL promoted_at means "draft": the wine is persisted (so scan-time
-- enrichment has a row to attach to) but excluded from every list, count,
-- and query until the developer explicitly promotes it via
-- POST /:id/promote. Not encoded as "all tags false" — that makes an
-- abandoned scan indistinguishable from a wine the developer deliberately
-- removed from every list, which defeats the 24h draft sweep (WI-7).
--
-- Existing rows are backfilled to already-promoted: every wine in the
-- database before this migration was already visible in a list, under the
-- pre-9.4 rule that tag_discovered was set automatically on creation.

ALTER TABLE wines ADD COLUMN promoted_at TEXT;
UPDATE wines SET promoted_at = date_added WHERE promoted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wines_promoted_at ON wines(promoted_at);
