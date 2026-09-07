-- Sports -----------------------------------------------------------------------
CREATE TABLE sports_markets (
  market_id       TEXT PRIMARY KEY,        -- Polymarket conditionId
  question        TEXT NOT NULL,
  sport           TEXT,
  home_team       TEXT,
  away_team       TEXT,
  game_start_time TIMESTAMPTZ,
  resolves_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sports_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  market_id             TEXT REFERENCES sports_markets(market_id),
  ts                    TIMESTAMPTZ NOT NULL,
  price_yes             NUMERIC,
  price_no              NUMERIC,
  spread                NUMERIC,
  volume_24h            NUMERIC,
  book_depth            NUMERIC,
  minutes_to_game_start INTEGER
);
CREATE INDEX sports_snapshots_market_ts ON sports_snapshots (market_id, ts);

CREATE TABLE sports_resolutions (
  market_id   TEXT PRIMARY KEY REFERENCES sports_markets(market_id),
  resolved_at TIMESTAMPTZ,
  outcome     TEXT,
  final_score TEXT
);

-- Weather --------------------------------------------------------------------
CREATE TABLE weather_markets (
  market_id                TEXT PRIMARY KEY,
  question                 TEXT NOT NULL,
  location                 TEXT,
  metric                   TEXT,
  threshold                NUMERIC,
  measurement_window_start TIMESTAMPTZ,
  measurement_window_end   TIMESTAMPTZ,
  resolves_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE weather_snapshots (
  id         BIGSERIAL PRIMARY KEY,
  market_id  TEXT REFERENCES weather_markets(market_id),
  ts         TIMESTAMPTZ NOT NULL,
  price_yes  NUMERIC,
  price_no   NUMERIC,
  spread     NUMERIC,
  volume_24h NUMERIC,
  book_depth NUMERIC
);
CREATE INDEX weather_snapshots_market_ts ON weather_snapshots (market_id, ts);

CREATE TABLE weather_resolutions (
  market_id             TEXT PRIMARY KEY REFERENCES weather_markets(market_id),
  resolved_at           TIMESTAMPTZ,
  outcome               TEXT,
  actual_measured_value NUMERIC
);
