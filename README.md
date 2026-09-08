# PolyScrape

Read-only market-data collector for **Limitless Exchange** prediction markets.
Discovers markets across every category, snapshots price / spread / volume / book
depth on an interval, records resolutions with the winning outcome, stores
everything in Postgres. No trading, no auth, no wallet keys.

> Originally built against Polymarket; migrated to Limitless (Polymarket isn't
> usable from the NL). Migration `003_limitless.sql` drops the old schema.

## What it collects

| Table | Rows |
|---|---|
| `markets` | one row per tracked binary market, keyed by Limitless `slug`. Includes metadata: `description`, `creator_*`, `oracle_ticker`/`oracle_asset_type`/`oracle_source`, `strike_price` (parsed from the description), `frequency`, `automation_type`, `is_rewardable`, `max_spread`/`daily_reward`/`rebate_rate`/`creator_fee_pct`/`min_size` |
| `snapshots` | one row per market per snapshot cycle. Price/volume/midpoint/spread, plus top-10 `book_bids`/`book_asks` (JSONB), `depth_1c`/`depth_2c`/`depth_5c` (resting size in outcome tokens within N¢ of mid), `buy_yes_price`/`sell_yes_price` (effective market cost each way), `slippage` (JSONB: buy/sell fill-vs-midpoint for the configured order sizes), and `underlying_price` (reference spot for the market's oracle ticker) |
| `trades` | public MINED CLOB fills — side, price, size, USDC, taker, outcome — polled for the order-book target set |
| `underlying_prices` | reference spot (`ticker`, `ts`, `price`, `source`), one row per ticker per cycle — `coingecko` for crypto, `tiingo` for equities |
| `gas_prices` | Base L2 gas price (`ts`, `gas_price_gwei`, `source`), one row per snapshot cycle. Informational — nothing reads it yet |
| `resolutions` | one row per market once it resolves; collector then stops snapshotting it |

- **Discovery** pages through `GET /markets/active` (all categories at once),
  flattens group / NegRisk markets into their child binary markets, and upserts
  every market whose expiration is at least `MIN_MARKET_MINUTES` away. The
  market's own `categories` array (e.g. `{Daily,Bitcoin}`) is stored for
  filtering; a market can be in several categories. The **snapshot** job runs the
  same upsert every cycle, so recurring markets (hourly/daily crypto series that
  open the moment the previous one resolves) are tracked within one snapshot
  interval rather than waiting for the 3-hourly discovery sweep.  Recurring
  markets carry a timestamp-free `stable_slug` (`btc-daily-price`) linking the
  series.
- **Snapshot** re-fetches `GET /markets/active` once per cycle (~30 requests) for
  `price_yes` / `price_no` / `volume` / `buy_yes_price` / `sell_yes_price` across
  the whole tracked set, then for the `ORDERBOOK_LIMIT` soonest-to-expire markets
  only pulls the order book (`spread`, `midpoint`, `book_bids`/`book_asks`,
  `depth_*`, `slippage`) and the trade tape. Once per cycle it also records one
  Base gas reading and one batched underlying-spot fetch (CoinGecko for crypto
  tickers, Tiingo for equity tickers). This keeps request volume under the
  Limitless (Cloudflare) rate limit.
- **Resolution** — a tracked market that has dropped out of the active list, or
  whose `winningOutcomeIndex` is set, is confirmed with a single
  `GET /markets/:slug` and recorded (`winning_outcome_index` 0 = Yes, 1 = No).
- **Retention** — a periodic sweep thins the snapshot history of long-resolved
  markets (see *Retention* below). It does not run on collector boot.

Nothing is parsed out of titles — Limitless gives structured `categories`,
`expirationTimestamp`, `tokens`, and `prices`, all stored as-is.

## Configuration

Copy `.env.example` to `.env` and adjust:

| Var | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres connection string |
| `LIMITLESS_API_HOST` | `https://api.limitless.exchange` | API base URL |
| `SNAPSHOT_INTERVAL_MINUTES` | `2` | how often to snapshot every tracked market |
| `DISCOVERY_INTERVAL_HOURS` | `3` | how often to rescan for new markets |
| `RESOLUTION_CHECK_INTERVAL_MINUTES` | `20` | how often to sweep due markets for resolution |
| `MIN_MARKET_MINUTES` | `30` | skip markets expiring within this many minutes of discovery (the 5-/15-min crypto churn). `0` tracks everything |
| `ORDERBOOK_LIMIT` | `100` | order book + trade-tape polling per snapshot cycle, soonest-to-expire first. `0` disables |
| `UNDERLYING_ENABLED` | `true` | collect crypto spot into `underlying_prices` (one CoinGecko request/cycle) |
| `TIINGO_API_KEY` | _(blank)_ | Tiingo IEX key for equity underlying. Blank = skip equities. Free key from [tiingo.com](https://www.tiingo.com/) |
| `EQUITY_STALE_MINUTES` | `20` | only store a Tiingo quote if its trade timestamp is fresher than this — skips writes while US markets are closed |
| `SLIPPAGE_ORDER_SIZES_USDC` | `50,250,1000` | order sizes for the per-snapshot `slippage` estimate |
| `GAS_TRACKING_ENABLED` | `true` | record one Base gas price per snapshot cycle into `gas_prices` |
| `BASE_RPC_URL` | `https://mainnet.base.org` | RPC endpoint for the `eth_gasPrice` call |
| `RETENTION_INTERVAL_HOURS` | `24` | how often the decimation sweep runs |
| `RETENTION_FULL_DAYS` | `7` | keep full 2-min resolution until a market has been resolved this long |
| `RETENTION_COARSE_MINUTES` | `15` | after that, thin to one collection cycle per this many minutes |
| `RETENTION_DROP_DAYS` | `0` | `>0` also hard-deletes all snapshots for markets resolved longer ago than this; `0` = never |
| `LIMITLESS_RPS` | `6` | process-wide cap on requests/sec to the API (Cloudflare 429s bursts) |
| `HTTP_CONCURRENCY` | `4` | max in-flight requests |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `HEALTH_PORT` | `8080` | port for the internal `/health` endpoint |

### Retention (downsampling)

`snapshots` grows ~1M rows/day. A sweep (`runRetention`, scheduled every
`RETENTION_INTERVAL_HOURS`, **not run on boot**) keeps this bounded:

- Markets that are **pending** or **resolved within `RETENTION_FULL_DAYS`** keep
  every 2-minute snapshot untouched.
- For markets **resolved more than `RETENTION_FULL_DAYS` ago**, each
  `RETENTION_COARSE_MINUTES` window is thinned to the single latest collection
  cycle in it — a whole cycle is kept or dropped, so group-market sibling rows
  stay aligned on `ts`.
- `RETENTION_DROP_DAYS > 0` additionally removes *all* snapshots for markets
  resolved longer ago than that.

**Effect on queries:** for a market resolved more than `RETENTION_FULL_DAYS` ago,
its snapshots are spaced ~`RETENTION_COARSE_MINUTES` apart, not 2 minutes.
`getCalibration()` is unaffected — its match tolerance (±3h around the
pre-resolution offset) is far wider than the coarse interval. Any ad-hoc query
that needs sub-`RETENTION_COARSE_MINUTES` granularity on old resolved markets
won't find it; set `RETENTION_FULL_DAYS` higher (more disk) if you need a longer
full-resolution tail. `trades`, `underlying_prices`, and `gas_prices` are not
touched by retention.

If monthly volume eventually outgrows a single VPS, the next step is native
monthly range-partitioning of `snapshots` so old partitions can be dropped
instantly — deliberately not done yet (create-copy-swap migration, no payoff at
current scale).

## Local development

Needs Node 22+ and a Postgres you can reach.

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your Postgres
npm run migrate               # create the schema
npm run dev                   # watch-mode; runs discovery once then the loops
```

```bash
npm test                      # unit tests for the pure bits
```

## Migrations

Plain numbered SQL in `migrations/`, applied by a small runner
(`src/db/migrate.ts`) that records applied files in `schema_migrations`.
Forward-only. The collector runs pending migrations on startup; by hand:

```bash
npm run migrate
```

```bash
docker compose run --rm collector node dist/db/migrate.js
```

## Deploy on a VPS

```bash
git clone <this repo> && cd PolyScrape
docker network create proxy-net        # once; shared with Nginx Proxy Manager
docker compose up -d --build
```

**Accounts / keys:** everything works with no keys except the **equity underlying
feed**, which needs a free [Tiingo](https://www.tiingo.com/) API key (email
signup) in `TIINGO_API_KEY`. Without it, `EQUITY`-oracle markets (AAPL, NVDA, SPY,
…) still store their ticker but `underlying_price` stays null. Crypto underlying
(CoinGecko) and Base gas (`eth_gasPrice` on the public RPC) need nothing.

`docker-compose.yml` starts three services:

- `db` — `postgres:16-alpine`, data in the named volume `pgdata`
- `collector` — multi-stage build, non-root, migrates on boot, then loops
- `frontend` — read-only viewer (see [Frontend](#frontend-data-viewer))

```bash
docker compose logs -f collector      # structured JSON logs
docker compose ps                     # collector/frontend show (healthy) once data flows
curl localhost:8080/health            # {"healthy":true,...}
```

`/health` is unhealthy if no snapshot cycle has completed in ~3 intervals; Docker
restarts on repeated failure.

## Check it's collecting

```bash
docker compose exec db psql -U polyscrape -d polyscrape
```

```sql
-- tracked vs resolved
SELECT (SELECT count(*) FROM markets)     AS markets,
       (SELECT count(*) FROM resolutions) AS resolved;

-- markets per category
SELECT unnest(categories) AS category, count(*)
FROM markets GROUP BY 1 ORDER BY 2 DESC;

-- snapshot volume in the last hour (~ markets * 60/SNAPSHOT_INTERVAL_MINUTES)
SELECT count(*), min(ts), max(ts) FROM snapshots WHERE ts > now() - interval '1 hour';

-- latest prices for the most-traded markets
SELECT m.title, s.price_yes, s.spread, s.volume, s.book_depth, s.ts
FROM snapshots s JOIN markets m USING (slug)
WHERE s.ts > now() - interval '10 minutes'
ORDER BY s.volume DESC NULLS LAST LIMIT 20;

-- price path for one market
SELECT ts, price_yes, minutes_to_expiration
FROM snapshots WHERE slug = '<slug>' ORDER BY ts;

-- resolved markets and outcome
SELECT m.title, r.winning_outcome, r.resolved_at
FROM resolutions r JOIN markets m USING (slug)
ORDER BY r.resolved_at DESC LIMIT 20;
```

## Frontend (data viewer)

A read-only Next.js app in [`frontend/`](frontend/) — own `package.json` and
Dockerfile, no shared code with the collector, `pg` pool pinned to
`default_transaction_read_only=on`.

**Views**

- **Overview** (`/`) — total markets, resolved vs pending, and a per-category
  breakdown (rows sum to more than the total since a market can be in several
  categories).
- **Market browser** (`/markets`, optional `?category=`) — filterable/sortable
  table (text, category, resolved state); row → detail; `↗` opens the market on
  Limitless. Multi-outcome (group / NegRisk) markets — soccer 3-ways, "winner"
  markets, dated "by …?" markets — collapse to one expandable row per event
  showing the favourite. Recurring series (hourly/daily crypto) collapse to one
  row showing the live market; expand for the resolved history.
- **Market detail** (`/markets/<slug>`) — `price_yes` line chart over the snapshot
  history; if resolved, a marker at the resolution time plus the winning outcome
  next to the final market price. Spread + volume in a companion chart.
- **Calibration** (`/calibration`) — resolved markets bucketed by market-implied
  P(yes) at a configurable lead time before **expiration** (default 24h), plotted
  as predicted probability vs. actual outcome frequency against the diagonal.
  Ten 0.1-wide bins; snapshot matched within ±3h; bins with <5 markets hidden.
  "Yes" = `winning_outcome_index = 0`. Filters: **category**, and **market type**
  (all / standalone / group-children) so 3-way legs don't contaminate binary
  calibration. For group markets the predicted probability is normalized by the
  group's pool (child price ÷ sum of the group's children prices at that
  snapshot) so each event sums to 1 and the overround is removed.

**API** (read-only JSON): `GET /api/overview`, `/api/categories`,
`/api/markets?category=`, `/api/markets/:slug/snapshots`,
`/api/calibration?category=&hoursBeforeExpiration=&marketType=all|standalone|group`.

### Local dev

```bash
cd frontend
npm install
cp .env.example .env          # same DATABASE_URL as the collector
npm run dev                   # http://localhost:3000
```

### In the VPS stack

`docker compose up -d --build` builds `frontend` alongside `db` and `collector`.
It reads the same `DATABASE_URL` and is on two networks: the internal `default`
(to reach `db`) and the external **`proxy-net`** shared with Nginx Proxy Manager.
Point a Proxy Host at `frontend:3000` (no published port needed; `${FRONTEND_PORT:-8081}`
maps to the host for direct/debug access). No TLS or auth in the app — NPM handles that.

## Layout

```
src/
  config.ts        env parsing
  logger.ts        JSON-to-stdout logging
  http.ts          fetch wrapper: UA, retry/backoff, global rate limiter, concurrency pool
  limitless.ts     Limitless API client: active markets, market detail, order book, trade tape, group flattening
  coingecko.ts     underlying crypto spot (batched, no key)
  tiingo.ts        underlying equity spot (Tiingo IEX, batched, fresh-quote-only)
  base.ts          Base L2 gas price (eth_gasPrice)
  slippage.ts      order-book walk → market-order slippage vs midpoint (pure)
  collector.ts     discovery / bulk snapshot (book, trades, slippage, underlying, gas, metadata) / resolution / retention
  health.ts        /health endpoint
  index.ts         migrate, then four setInterval loops (discovery, snapshot, resolution, retention)
migrations/     001/002 retired Polymarket schema; 003 Limitless schema; 004/005 indexes + stable_slug;
                006 book levels / trades / underlying / metadata; 007 retention index; 008 slippage;
                009 gas_prices; 010 equity-underlying index

frontend/          read-only Next.js viewer (own package.json / Dockerfile)
  src/lib/         pg pool (read-only) + all SQL + shared types
  src/app/         pages (overview, markets, markets/[slug], calibration) + /api routes
  src/components/  Nav, MarketTable, PriceChart, CalibrationChart
```
