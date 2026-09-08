-- Estimated market-order slippage vs. midpoint, computed at snapshot time by
-- walking the stored order-book levels for each size in SLIPPAGE_ORDER_SIZES_USDC.
--
-- Only populated for the order-book-polled subset (null elsewhere, exactly like
-- midpoint / depth_*). Shape:
--   { "buy":  { "50": <vwap_buy  - midpoint>, "250": ..., "1000": ... },
--     "sell": { "50": <midpoint - vwap_sell>, "250": ..., "1000": ... } }
-- where vwap_* is the volume-weighted fill price for a market order of that many
-- USDC, buying YES off the asks / selling YES into the bids. A positive number is
-- cost (you pay above / receive below the midpoint). Keys are whatever sizes were
-- configured; JSONB so the size list can change without a schema migration.

ALTER TABLE snapshots ADD COLUMN slippage JSONB;
