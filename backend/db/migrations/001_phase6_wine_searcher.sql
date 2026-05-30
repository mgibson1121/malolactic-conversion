-- Phase 6: Wine-Searcher integration
-- Adds individual ws_* columns for Wine-Searcher pricing and score data.
-- The existing price_data JSON column is retained but ws_* columns are the
-- canonical storage for Wine-Searcher data from Phase 6 onward.

ALTER TABLE wines ADD COLUMN ws_price_min REAL;
ALTER TABLE wines ADD COLUMN ws_price_avg REAL;
ALTER TABLE wines ADD COLUMN ws_price_max REAL;
ALTER TABLE wines ADD COLUMN ws_score REAL;
ALTER TABLE wines ADD COLUMN ws_price_fetched_at TEXT;
ALTER TABLE wines ADD COLUMN ws_retailers TEXT; -- JSON array: { name, price, url, location }
ALTER TABLE wines ADD COLUMN retailer_links TEXT; -- JSON object: { kl, zachys, woodland, benchmark }
