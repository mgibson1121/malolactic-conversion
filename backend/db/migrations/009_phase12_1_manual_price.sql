-- Phase 12.1 (D12, WI-1): the developer's own price for a wine.
--
-- A manual per-750 ml price, entered in the Edit screen when the automated
-- lookup returned strange, inaccurate or no results. When set it is *the*
-- price on every surface (shared/utils/effective-price.ts), the automated
-- avg/high/low stay visible but informational.
--
-- A column of its own, not a key inside price_data: every price fetch
-- rewrites that blob. Nothing automated ever writes this column. price_paid
-- is a different field and stays unsurfaced.

ALTER TABLE wines ADD COLUMN manual_price REAL;
