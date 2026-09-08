-- Base L2 gas price, one row per snapshot cycle (keyed by the shared cycle ts).
-- Captured via a single eth_gasPrice JSON-RPC call to BASE_RPC_URL per cycle.
--
-- Informational only: this is recorded for later cost-adjusted backtesting
-- (a market-order round trip on Limitless costs gas + fees). Nothing reads it yet.

CREATE TABLE gas_prices (
  ts             TIMESTAMPTZ PRIMARY KEY,
  gas_price_gwei NUMERIC,
  source         TEXT
);
