-- Deeper data for signal work: order-book shape, effective trade prices, trade
-- tape, underlying reference price, and market metadata.

-- (1) order-book levels + effective trade prices on each snapshot
ALTER TABLE snapshots
  ADD COLUMN book_bids      JSONB,    -- top ~10 [{price,size}], best first, size in USDC
  ADD COLUMN book_asks      JSONB,
  ADD COLUMN depth_1c       NUMERIC,  -- USDC resting within 1c of midpoint (both sides)
  ADD COLUMN depth_2c       NUMERIC,
  ADD COLUMN depth_5c       NUMERIC,
  ADD COLUMN buy_yes_price  NUMERIC,  -- market cost to buy YES  (tradePrices.buy.market[0])
  ADD COLUMN sell_yes_price NUMERIC,  -- market proceeds selling YES (tradePrices.sell.market[0])
  ADD COLUMN underlying_price NUMERIC; -- reference spot for the market's oracle ticker at ts

-- (4) market metadata (all from the discovery payload)
ALTER TABLE markets
  ADD COLUMN description       TEXT,
  ADD COLUMN creator_name      TEXT,
  ADD COLUMN creator_address   TEXT,
  ADD COLUMN automation_type   TEXT,     -- lumy | manual
  ADD COLUMN frequency         TEXT,     -- daily | hourly | ... (from tags/properties)
  ADD COLUMN is_rewardable     BOOLEAN,
  ADD COLUMN tags              TEXT[],
  ADD COLUMN oracle_ticker     TEXT,     -- priceOracleMetadata.ticker
  ADD COLUMN oracle_asset_type TEXT,     -- CRYPTO | EQUITY
  ADD COLUMN oracle_source     TEXT,     -- pyth-pro | chainlink | ...
  ADD COLUMN strike_price      NUMERIC,  -- "price to beat" parsed from description, nullable
  ADD COLUMN max_spread        NUMERIC,
  ADD COLUMN daily_reward      NUMERIC,
  ADD COLUMN rebate_rate       NUMERIC,
  ADD COLUMN creator_fee_pct   NUMERIC,
  ADD COLUMN min_size          NUMERIC;  -- USDC
CREATE INDEX markets_oracle_ticker ON markets (oracle_ticker) WHERE oracle_ticker IS NOT NULL;

-- (2) trade tape — public MINED CLOB fills
CREATE TABLE trades (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT NOT NULL REFERENCES markets(slug),
  tx_hash     TEXT,
  token_id    TEXT,
  outcome     TEXT,               -- 'Yes' | 'No'
  side        TEXT,               -- 'buy' | 'sell' (taker side)
  price       NUMERIC,
  size        NUMERIC,            -- position tokens (matchedSize / 1e6)
  collateral  NUMERIC,            -- USDC (takerAmount / 1e6)
  taker       TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  UNIQUE (tx_hash, token_id, created_at, price)
);
CREATE INDEX trades_slug_ts ON trades (slug, created_at);

-- (3) underlying reference price, one row per ticker per collection cycle
CREATE TABLE underlying_prices (
  ticker TEXT NOT NULL,
  ts     TIMESTAMPTZ NOT NULL,
  price  NUMERIC NOT NULL,
  source TEXT,
  PRIMARY KEY (ticker, ts)
);
