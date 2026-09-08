-- Equity underlying feed (Tiingo IEX). No column changes — underlying_prices.source
-- already distinguishes providers ('coingecko' for crypto, 'tiingo' for equities).
-- This migration just adds a time index; with two feeds writing to the table,
-- time-range joins against snapshots become common.

CREATE INDEX IF NOT EXISTS underlying_prices_ts ON underlying_prices (ts);
