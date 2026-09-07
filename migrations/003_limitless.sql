-- Pivot: data source changed from Polymarket to Limitless Exchange.
-- The Polymarket sports/weather schema is replaced wholesale. Any collected
-- Polymarket data is dropped (it was a few days of a source we no longer use).

DROP TABLE IF EXISTS sports_snapshots, sports_resolutions, sports_markets,
                     weather_snapshots, weather_resolutions, weather_markets CASCADE;

-- One row per tracked Limitless binary market (group markets are flattened to
-- their child markets, each of which is its own binary Yes/No market).
CREATE TABLE markets (
  slug               TEXT PRIMARY KEY,
  market_id          BIGINT,
  condition_id       TEXT,
  title              TEXT NOT NULL,
  categories         TEXT[] NOT NULL DEFAULT '{}',
  market_type        TEXT,               -- 'single' | 'group-child'
  trade_type         TEXT,               -- 'clob' | 'amm'
  group_slug         TEXT,               -- parent group slug, if any
  yes_token_id       TEXT,
  no_token_id        TEXT,
  source_created_at  TIMESTAMPTZ,        -- market createdAt on Limitless
  start_at           TIMESTAMPTZ,
  expiration         TIMESTAMPTZ,        -- expirationTimestamp
  first_seen         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX markets_categories_gin ON markets USING gin (categories);
CREATE INDEX markets_expiration ON markets (expiration);

CREATE TABLE snapshots (
  id                BIGSERIAL PRIMARY KEY,
  slug              TEXT NOT NULL REFERENCES markets(slug),
  ts                TIMESTAMPTZ NOT NULL,
  price_yes         NUMERIC,
  price_no          NUMERIC,
  midpoint          NUMERIC,
  best_bid          NUMERIC,
  best_ask          NUMERIC,
  spread            NUMERIC,
  last_trade_price  NUMERIC,
  volume            NUMERIC,
  book_depth        NUMERIC,             -- summed bid + ask size
  minutes_to_expiration INTEGER
);
CREATE INDEX snapshots_slug_ts ON snapshots (slug, ts);

CREATE TABLE resolutions (
  slug                  TEXT PRIMARY KEY REFERENCES markets(slug),
  resolved_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  winning_outcome_index INTEGER,          -- 0 = Yes, 1 = No
  winning_outcome       TEXT,             -- 'Yes' | 'No'
  status                TEXT
);
