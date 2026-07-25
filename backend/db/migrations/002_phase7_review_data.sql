-- Phase 7: review & critic score sourcing
-- Adds review_data: JSON array of per-retailer results,
-- [{ slug, name, product_url, critic_scores: [{ publication, score }], fetched_at }].
-- Populated independently of price_data by backend/modules/reviews/.

ALTER TABLE wines ADD COLUMN review_data TEXT;
