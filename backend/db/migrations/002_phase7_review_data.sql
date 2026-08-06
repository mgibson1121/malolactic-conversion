-- Phase 7: review & critic score sourcing
-- Adds review_data: JSON array of per-retailer results,
-- [{ slug, name, product_url, critic_scores: [{ publication, score }], fetched_at }].
-- Populated independently of price_data by backend/modules/reviews/.
--
-- Phase 9.1 (2026-08-04) added three keys per entry — page_vintage,
-- vintage_gap, and match (the per-dimension MatchVerdict the result was
-- accepted on). No DDL change was needed: this is a JSON column, and the
-- authoritative shape is shared/types.ts RetailerReview. This comment is
-- updated rather than a new migration added, precisely because there is no
-- schema change to migrate — see docs/specs/2026-08-04-phase-9.1-identity-
-- matching-remediation.md WI-1.

ALTER TABLE wines ADD COLUMN review_data TEXT;
