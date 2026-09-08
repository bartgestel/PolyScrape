# PolyScrape — Technical Documentation

_Last updated: 2026-09-08 · schema version: migration `010`_

## 1. Purpose & scope

PolyScrape is the **data-collection layer** for an AI-driven prediction-market
trading bot. It is deliberately in a *collection-only* phase: it discovers
markets, records a time series of prices / order books / trades / resolutions,
and exposes a read-only viewer. **No trading, signal, or AI logic exists yet** —
the point is to accumulate a clean corpus for backtesting before any strategy is
built.

The data source is **Limitless Exchange** (`api.limitless.exchange`), a
CLOB/AMM prediction market on Base. (The project was originally built against
Polymarket; it was migrated wholesale in migration `003` because Polymarket is
not usable from the operator's jurisdiction. All Polymarket-era code and schema
are retired.)

Two deployables:

| Service | Language / stack | Role |
|---|---|---|
| **collector** | Node 22, TypeScript, `pg` | polls Limitless, writes Postgres |
| **frontend** | Next.js 16, React 19, Recharts | read-only viewer over the same Postgres |

Both are read-only against Limitless (no API key, no wallet). The frontend's DB
pool is pinned `default_transaction_read_only=on`.

---

## 2. Repository layout

```
├── src/                      collector
│   ├── index.ts              entrypoint: migrate, then 4 setInterval loops
│   ├── config.ts             env parsing (fail-fast on DATABASE_URL)
│   ├── logger.ts             JSON-lines logging to stdout
│   ├── http.ts               fetch wrapper: UA, retry/backoff, global rate limiter, mapLimit pool
│   ├── limitless.ts          Limitless API client + pure helpers (flatten, parseStrike, frequency)
│   ├── coingecko.ts          underlying crypto spot (batched, keyless)
│   ├── tiingo.ts             underlying equity spot (Tiingo IEX, batched, fresh-quote-only)
│   ├── base.ts               Base L2 gas price (eth_gasPrice JSON-RPC)
│   ├── slippage.ts           order-book walk → market-order slippage vs midpoint (pure)
│   ├── collector.ts          discovery / snapshot / resolution / retention
│   ├── health.ts             GET /health
│   └── db/
│       ├── index.ts          pg Pool + query()
│       └── migrate.ts        numbered-SQL migration runner
├── migrations/               001–010 (001/002 = retired Polymarket schema)
├── test/                     node:test unit tests for pure helpers
├── Dockerfile                collector image (multi-stage, non-root)
├── docker-compose.yml        db + collector + frontend
├── .env.example
└── frontend/
    ├── src/lib/              db.ts (read-only pool), queries.ts (all SQL), types.ts
    ├── src/app/              pages + /api route handlers (App Router)
    │   ├── page.tsx                overview
    │   ├── markets/page.tsx        market browser
    │   ├── markets/[slug]/page.tsx market detail
    │   ├── calibration/page.tsx    calibration (client component)
    │   └── api/{overview,categories,markets,markets/[slug]/snapshots,calibration}/route.ts
    ├── src/components/       Nav, MarketTable, PriceChart, CalibrationChart
    ├── Dockerfile            Next standalone image
    └── next.config.mjs       output: "standalone", turbopack.root pinned
```

---

## 3. Data source: Limitless Exchange API

Base URL `https://api.limitless.exchange`. All endpoints below are public
(no auth). Responses are JSON. Cloudflare fronts the API and returns **HTTP 429
(error 1015)** on bursts — see §4.5.

| Endpoint | Used for |
|---|---|
| `GET /markets/active?page=N` | discovery + bulk snapshot. 25 markets/page, `{ data[], totalMarketsCount }`. Each item carries price, volume, tokens, **full metadata** (description, creator, `priceOracleMetadata`, `settings`, `tradePrices`, `tags`, `properties`), and for `marketType:"group"` a nested `markets[]` of child binary markets. |
| `GET /markets/:slug` | resolution confirmation for markets that vanished from the active list (`winningOutcomeIndex`, `status`). |
| `GET /markets/:slug/orderbook` | per-market book: `bids[]`, `asks[]` (`{price, size}`, size in USDC 6-dec), `adjustedMidpoint`, `lastTradePrice`. |
| `GET /markets/:slug/events?page=1&limit=100` | trade tape — public **MINED** CLOB fills, newest first. `side` (0=BUY, 1=SELL taker), `price`, `matchedSize` / `takerAmount` (raw 6-dec), `tokenId`, `txHash`, `profile.account`. Cached 30s. |
| `GET /categories` | category id/name list (informational; not required by the collector). |

**External:** `GET https://api.coingecko.com/api/v3/simple/price?ids=…&vs_currencies=usd`
— one batched request per cycle for crypto underlying spot. Keyless.

### Market shape notes

- **Binary only.** Every tracked row is a Yes/No market. `prices` is `[yes, no]`,
  `tokens` is `{yes, no}` token ids.
- **Group / NegRisk markets** (`marketType:"group"`) are *flattened* to their
  child markets. Each child has its own `slug`, `conditionId`, `tokens`,
  `prices`, `winningOutcomeIndex`. Examples: soccer 3-ways (home / away / Draw),
  "winner" markets, dated "X by …?" markets. Stored with
  `market_type='group-child'` and `group_slug` = the parent slug; title becomes
  `"<group title> — <child title>"`.
- **Recurring markets** (5-min / 15-min / hourly / daily / weekly crypto & stock
  up-down) share a timestamp-free `stableSlug` (e.g. `btc-daily-price`). Each
  instance is a separate market; `stable_slug` links the series.
- **Oracle metadata** (`priceOracleMetadata`): `ticker` (BTC, ETH, AAPL…),
  `assetType` (`CRYPTO` | `EQUITY`), `chartSource` (`pyth-pro`, `chainlink`).
- **Strike / "price to beat"**: not a structured field — it appears in the
  `description` HTML (`"…captured … was $79,713.44…"`) and is regex-extracted
  (`parseStrike`), nullable.

---

## 4. Collector service (`src/`)

### 4.1 Runtime

`index.ts`:

1. `runMigrations()` — apply any pending `migrations/*.sql`.
2. `startHealthServer()` — `GET /health` on `HEALTH_PORT`.
3. One awaited `runDiscovery()` to seed the tables.
4. Four non-overlapping `setInterval` loops (`schedule()` guards against
   re-entry and swallows errors so one failure never kills the process):

| Loop | Default cadence | Runs on boot? | Env |
|---|---|---|---|
| discovery | 3 h | no (seeded once, awaited) | `DISCOVERY_INTERVAL_HOURS` |
| snapshot | 2 min | yes | `SNAPSHOT_INTERVAL_MINUTES` |
| resolution | 20 min | yes | `RESOLUTION_CHECK_INTERVAL_MINUTES` |
| retention | 24 h | **no** | `RETENTION_INTERVAL_HOURS` |

SIGINT/SIGTERM drain the pool and exit 0.

### 4.2 Discovery — `runDiscovery()` / `upsertActive()`

- Paginate `GET /markets/active` fully (`fetchActiveMarkets`), `flattenMarkets`
  to expand groups.
- Filter out markets expiring within `MIN_MARKET_MINUTES` (default 30) — the
  sub-hour crypto churn never lives long enough to yield useful history. `0`
  keeps everything.
- `INSERT … ON CONFLICT (slug) DO UPDATE` into `markets` with the full metadata
  column set (`MARKET_COLS`).
- **The snapshot loop also calls `upsertActive()` every cycle** (§4.3), so new
  markets — especially recurring ones that open the instant the previous
  instance resolves — are tracked within one snapshot interval rather than
  waiting up to 3 h for the discovery sweep. The 3-h discovery loop is a
  backstop.

### 4.3 Snapshot — `runSnapshot()`

Per cycle:

1. `activeBySlug()` → one full `GET /markets/active` pagination (~25–60 requests).
2. `upsertActive()` on that data (picks up new markets).
3. `trackedMarkets(false)` → all `markets` rows without a `resolutions` row.
   Split into **present** (still in the active list) and **missing** (gone).
4. **Order book + trade tape** for the `ORDERBOOK_LIMIT` (default 100)
   soonest-to-expire *present* markets:
   - `fetchOrderBook` → `bookMetrics()`: best bid/ask, spread, midpoint, total
     depth, top-10 `book_bids`/`book_asks` (JSON), `depth_1c` / `depth_2c` /
     `depth_5c` (resting size in outcome tokens within N¢ of mid), and
     `slippage` (`computeSlippage` from `src/slippage.ts` — walks the levels to a
     VWAP fill price for each `SLIPPAGE_ORDER_SIZES_USDC` size, stores the
     signed difference from midpoint for buy-YES and sell-YES).
   - `recordTrades()` → `fetchMarketEvents` (page 1, 100 fills) → insert into
     `trades` with `ON CONFLICT (tx_hash, token_id, created_at, price) DO NOTHING`.
     `outcome` resolved from `tokenId` vs the market's yes token; `side` from
     `0/1`; `size` = `matchedSize/1e6`, `collateral` = `takerAmount/1e6`.
5. **Underlying** — `fetchUnderlyingMap()`: split the present set's oracle
   tickers by `assetType`. `CRYPTO` → one CoinGecko batch call
   (`UNDERLYING_ENABLED`). `EQUITY` → one Tiingo IEX batch call
   (`src/tiingo.ts`, needs `TIINGO_API_KEY`) — a quote is kept only if its trade
   timestamp is fresher than `EQUITY_STALE_MINUTES`, so nothing is stored while
   US markets are closed. Rows go to `underlying_prices` with `source` =
   `coingecko` / `tiingo`; returns a merged `ticker→price` map.
6. **Gas** — `recordGas()`: one `eth_gasPrice` JSON-RPC call to `BASE_RPC_URL`
   (`src/base.ts`), converted to gwei, inserted into `gas_prices` keyed by the
   cycle `ts` (`GAS_TRACKING_ENABLED`). Off the Limitless rate gate.
7. Build one `snapshots` row per present market: price/volume from the bulk list
   payload (free for **all** markets), book metrics + `slippage` for the polled
   subset, `buy_yes_price`/`sell_yes_price` from `tradePrices.buy/sell.market[0]`
   (in the bulk payload, so present for nearly all markets),
   `underlying_price` from the map, `minutes_to_expiration` computed.
   Batched insert (300/statement).
8. **Resolution during snapshot:** present markets with a non-null
   `winningOutcomeIndex` → `resolutions`; missing markets → `resolveMissing()`
   (capped 300/cycle) confirms via `GET /markets/:slug`.
9. `markSnapshotOk()` updates the health timestamp.

All timestamps in a cycle use one shared `ts` — this is what makes the
calibration group-normalization (§6.4) able to join siblings on exact `ts`.

### 4.4 Resolution — `runResolution()` (backstop)

Independent 20-min loop. `trackedMarkets(true)` (unresolved AND past expiration)
→ those absent from the current active list → `resolveMissing()` (capped 500).
Redundant with the snapshot path but runs on a different cadence and catches
anything the snapshot cap skipped.

### 4.4b Retention — `runRetention()`

24-h loop, **not run on boot** (the first pass can be large). Two DB-only steps,
each batched at 20k rows:

1. `RETENTION_DROP_DAYS > 0` → hard-delete every `snapshots` row whose market
   resolved more than that many days ago. Default `0` (disabled).
2. Decimate: for markets resolved more than `RETENTION_FULL_DAYS` (default 7)
   ago, group their snapshots into `RETENTION_COARSE_MINUTES` (default 15)
   buckets (`date_bin`) and delete every row except the one at the latest cycle
   `ts` in each bucket. Because every market in a cycle shares one `ts`, whole
   cycles are kept or dropped — group-market siblings stay aligned, so
   `getCalibration`'s exact-`ts` sibling join keeps working.

Pending markets and markets resolved within `RETENTION_FULL_DAYS` are never
touched. `trades` / `underlying_prices` / `gas_prices` are not touched.

### 4.5 Rate-limit strategy

Limitless/Cloudflare hard-limits bursts. The collector keeps request volume low
and paced:

- **Bulk over per-market.** Price/volume/effective-price/metadata for the entire
  tracked set (~1400 markets) come from ~30 `GET /markets/active` requests, not
  1400.
- **Capped deep polling.** Order book + trade tape only for `ORDERBOOK_LIMIT`
  markets/cycle, chosen by soonest expiration.
- **Global rate gate** (`http.ts` `rateGate`): every outbound request start is
  spaced ≥ `1000/LIMITLESS_RPS` ms process-wide (default 6 rps).
- **Concurrency pool** `mapLimit` — `HTTP_CONCURRENCY` (default 4) in-flight,
  further bounded by the rate gate. Deep-poll fan-out uses concurrency 3.
- **Retry** on 429/5xx/timeout: 5 attempts, backoff 1/2/4/8 s.
- Real `User-Agent` header (default undici UA gets 403'd).

Observed steady-state cycle cost ≈ 30 (bulk) + 100 (books) + 100 (trades) + 1
(CoinGecko) + 1 (Tiingo) + 1 (Base RPC) ≈ 233 requests → ~20–25 s at 6 rps
(Base RPC and CoinGecko/Tiingo are off the Limitless gate), well inside the
2-min interval.

### 4.6 Health

`GET /health` → `200 {healthy:true,…}` if a snapshot cycle completed within
`3 × SNAPSHOT_INTERVAL_MINUTES`, else `503`. Docker `HEALTHCHECK` calls it;
`restart: unless-stopped` recovers a wedged container.

---

## 5. Data model

Postgres 16. Forward-only numbered migrations (`schema_migrations` tracks
applied files). Current tables:

### `markets` — one row per tracked binary market

| Column | Type | Notes |
|---|---|---|
| `slug` | text PK | Limitless market slug (stable natural key) |
| `market_id` | bigint | Limitless numeric id |
| `condition_id` | text | on-chain condition id |
| `title` | text | `"<group> — <child>"` for group children |
| `categories` | text[] | e.g. `{Daily,Bitcoin}`; GIN-indexed |
| `market_type` | text | `single` \| `group-child` |
| `trade_type` | text | `clob` \| `amm` |
| `group_slug` | text | parent group slug (partial index) |
| `stable_slug` | text | recurring-series id, e.g. `btc-daily-price` (partial index) |
| `yes_token_id` / `no_token_id` | text | outcome token ids |
| `source_created_at` / `start_at` / `expiration` | timestamptz | market lifecycle (`expiration` indexed) |
| `first_seen` | timestamptz | when the collector first saw it |
| `description` | text | resolution rules HTML |
| `creator_name` / `creator_address` | text | `Limitless` for official markets |
| `automation_type` | text | `lumy` \| `manual` |
| `frequency` | text | `daily` \| `hourly` \| … (from `properties`/`tags`) |
| `is_rewardable` | boolean | LP-reward eligible |
| `tags` | text[] | e.g. `{Daily,Lumy,Recurring}` |
| `oracle_ticker` | text | BTC, ETH, AAPL… (partial index) |
| `oracle_asset_type` | text | `CRYPTO` \| `EQUITY` |
| `oracle_source` | text | `pyth-pro`, `chainlink`, … |
| `strike_price` | numeric | "price to beat", regex-parsed from `description`, nullable |
| `max_spread` / `daily_reward` / `rebate_rate` / `creator_fee_pct` | numeric | from `settings` |
| `min_size` | numeric | min order size, USDC |

### `snapshots` — one row per market per snapshot cycle

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `slug` | text FK → markets | |
| `ts` | timestamptz | shared across all rows in a cycle; `(slug, ts)` indexed |
| `price_yes` / `price_no` | numeric | from the bulk list payload (all markets) |
| `midpoint` | numeric | book adjusted midpoint (polled subset) |
| `best_bid` / `best_ask` / `spread` | numeric | polled subset |
| `last_trade_price` | numeric | from the order-book response |
| `volume` | numeric | cumulative USDC (`volumeFormatted`) |
| `book_depth` | numeric | total resting size both sides, in outcome tokens |
| `book_bids` / `book_asks` | jsonb | top 10 `[{price,size}]`, best first, `size` in outcome tokens |
| `depth_1c` / `depth_2c` / `depth_5c` | numeric | resting size (outcome tokens) within 1/2/5¢ of midpoint |
| `slippage` | jsonb | `{"buy":{"<usd>":vwap−mid},"sell":{"<usd>":mid−vwap}}` — market-order fill vs midpoint per `SLIPPAGE_ORDER_SIZES_USDC` size, walking the stored levels; positive = cost |
| `buy_yes_price` / `sell_yes_price` | numeric | effective market cost to buy / proceeds to sell YES (`tradePrices`) |
| `underlying_price` | numeric | reference spot for `oracle_ticker` at `ts` (crypto + equity, see below) |
| `minutes_to_expiration` | integer | |

`price_yes`, `volume`, `buy_yes_price`, `sell_yes_price` are populated for ~all
markets each cycle. `midpoint`, `spread`, `book_*`, `depth_*`, `slippage` only for
the `ORDERBOOK_LIMIT` polled subset. `underlying_price` for `CRYPTO` markets whose
ticker maps in `coingecko.ts`, and for `EQUITY` markets when `TIINGO_API_KEY` is
set **and** the US market is open (fresh quote).

### `trades` — public MINED CLOB fills

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `slug` | text FK → markets | `(slug, created_at)` indexed |
| `tx_hash` / `token_id` | text | |
| `outcome` | text | `Yes` \| `No` (from `token_id` vs market yes token) |
| `side` | text | `buy` \| `sell` (taker side) |
| `price` | numeric | weighted avg fill price |
| `size` | numeric | position tokens (`matchedSize/1e6`) |
| `collateral` | numeric | USDC (`takerAmount/1e6`) |
| `taker` | text | taker account address |
| `created_at` | timestamptz | |
| — | | `UNIQUE (tx_hash, token_id, created_at, price)` dedupes re-polls |

Only collected for the `ORDERBOOK_LIMIT` polled subset each cycle.

### `underlying_prices` — reference spot series

| Column | Type | Notes |
|---|---|---|
| `ticker` | text | `(ticker, ts)` PK; `ts` also indexed |
| `ts` | timestamptz | one row per ticker per cycle |
| `price` | numeric | USD |
| `source` | text | `coingecko` (crypto) \| `tiingo` (equity, IEX last trade) |

Equity rows are only written while the US market is open — a Tiingo quote is
stored only if its trade timestamp is within `EQUITY_STALE_MINUTES`, so
nights/weekends/holidays simply produce no row (no market-calendar needed).

### `gas_prices` — Base L2 gas, one row per snapshot cycle

| Column | Type | Notes |
|---|---|---|
| `ts` | timestamptz PK | the shared snapshot-cycle `ts` |
| `gas_price_gwei` | numeric | `eth_gasPrice` from `BASE_RPC_URL`, wei → gwei |
| `source` | text | `base-rpc` |

Informational only — captured for later cost-adjusted backtesting (a market-order
round trip costs gas + fees). Nothing reads it yet. Not touched by retention.

### `resolutions` — one row per market once settled

| Column | Type | Notes |
|---|---|---|
| `slug` | text PK, FK → markets | |
| `resolved_at` | timestamptz | when the collector recorded it (not the on-chain time) |
| `winning_outcome_index` | integer | `0` = Yes, `1` = No |
| `winning_outcome` | text | `Yes` \| `No` |
| `status` | text | Limitless market status at detection |

A market with a `resolutions` row is no longer snapshotted.

### Retired

`migrations/001–002` created the Polymarket `sports_*` / `weather_*` tables;
`003` drops them. They no longer exist in a live DB.

---

## 6. Frontend service (`frontend/`)

### 6.1 Stack

Next.js 16 App Router, React 19, Recharts 3. Server components query Postgres
directly through `frontend/src/lib/db.ts` (lazy `pg` Pool, `max: 5`, pinned
read-only). `/api/*` route handlers are thin wrappers over the same
`queries.ts`. All pages/routes are `dynamic = "force-dynamic"`. Built as a Next
standalone image; runs as non-root on port 3000.

### 6.2 Views

| Route | What it shows |
|---|---|
| `/` | totals (tracked / resolved / pending) + per-category breakdown (`unnest(categories)`, so rows sum to more than the total). |
| `/markets` `?category=` | filterable/sortable table (text, category, resolved state). **Group markets** collapse to one expandable row per event showing the favourite outcome; **recurring series** (`stable_slug`) collapse to one row showing the live instance, expandable to resolved history. `↗` opens the market on Limitless. |
| `/markets/<slug>` | metadata panel (oracle/strike, costs, creator, frequency), `price_yes` line chart with resolution marker, an **underlying-price chart** with the strike as a reference line (crypto), a **spread & volume** companion chart, and a **recent-trades** table. |
| `/calibration` | reliability chart — see §6.4. Client component; refetches on control change. |

### 6.3 API routes

| Route | Returns |
|---|---|
| `GET /api/overview` | `OverviewSummary` |
| `GET /api/categories` | `string[]` distinct categories |
| `GET /api/markets?category=` | `MarketRow[]` (each with last snapshot price + resolution) |
| `GET /api/markets/:slug/snapshots` | `{ slug, snapshots: Snapshot[] }` (full richer set incl. `book_bids`, `depth_*`, `underlying_price`) |
| `GET /api/calibration?category=&hoursBeforeExpiration=&marketType=all\|standalone\|group` | `CalibrationResult` |

### 6.4 Calibration math (`getCalibration`)

For every resolved market:

1. Take the snapshot nearest to `expiration − hoursBeforeExpiration`
   (default 24 h), within **±3 h**; markets with no snapshot in that window are
   dropped (reported as `matchedMarkets`).
2. **Predicted probability:**
   - standalone market → `price_yes`.
   - group child → `price_yes ÷ Σ(price_yes of all the group's children at the
     same `ts`)` — normalizes the pool to 1 and removes the overround. Relies on
     the shared per-cycle `ts` (§4.3).
3. **Actual** = `1` if `winning_outcome_index = 0` else `0`.
4. Bucket into 10 bins of width 0.1 (`width_bucket`). Per bin: `n`,
   `predicted_mean`, `actual_freq`. Bins with `n < 5` are hidden.
5. Chart plots `predicted_mean` (x) vs `actual_freq` (y) with dot size ∝ `n`,
   against the diagonal.

Filters: **category** (`= ANY(categories)`) and **market type**
(`all` / `standalone` = `group_slug IS NULL` / `group` = `group_slug IS NOT
NULL`) — the latter so soccer `Draw` legs (which never price above ~0.35) don't
contaminate binary-market bins.

**Retention interaction:** step 1's ±3h match tolerance is far wider than
`RETENTION_COARSE_MINUTES` (default 15), so the decimation sweep (§4.4b) does not
affect this query. Markets keep full 2-min resolution for `RETENTION_FULL_DAYS`
after resolving, which is ample for the current match logic.

---

## 7. Configuration

All via environment variables (`.env` locally, `environment:` in compose). The
collector fails fast if `DATABASE_URL` is unset.

| Var | Default | Applies to | Meaning |
|---|---|---|---|
| `DATABASE_URL` | — (required) | both | Postgres connection string |
| `LIMITLESS_API_HOST` | `https://api.limitless.exchange` | collector | API base |
| `SNAPSHOT_INTERVAL_MINUTES` | `2` | collector | snapshot cadence |
| `DISCOVERY_INTERVAL_HOURS` | `3` | collector | discovery backstop cadence |
| `RESOLUTION_CHECK_INTERVAL_MINUTES` | `20` | collector | resolution sweep cadence |
| `MIN_MARKET_MINUTES` | `30` | collector | skip markets expiring within N min of discovery; `0` = everything |
| `ORDERBOOK_LIMIT` | `100` | collector | markets deep-polled (book + trades) per cycle, soonest-to-expire first; `0` disables |
| `UNDERLYING_ENABLED` | `true` | collector | collect crypto spot into `underlying_prices` |
| `TIINGO_API_KEY` | _(blank)_ | collector | Tiingo IEX key; blank = no equity underlying |
| `EQUITY_STALE_MINUTES` | `20` | collector | store a Tiingo quote only if its trade timestamp is fresher than this |
| `SLIPPAGE_ORDER_SIZES_USDC` | `50,250,1000` | collector | order sizes for `snapshots.slippage` |
| `GAS_TRACKING_ENABLED` | `true` | collector | write one Base gas reading per cycle to `gas_prices` |
| `BASE_RPC_URL` | `https://mainnet.base.org` | collector | RPC endpoint for `eth_gasPrice` |
| `RETENTION_INTERVAL_HOURS` | `24` | collector | decimation sweep cadence |
| `RETENTION_FULL_DAYS` | `7` | collector | keep 2-min resolution until a market is resolved this long |
| `RETENTION_COARSE_MINUTES` | `15` | collector | thin older resolved markets to one cycle per this many minutes |
| `RETENTION_DROP_DAYS` | `0` | collector | `>0` also hard-deletes snapshots for markets resolved longer ago; `0` = off |
| `LIMITLESS_RPS` | `6` | collector | process-wide outbound request/sec cap |
| `HTTP_CONCURRENCY` | `4` | collector | max in-flight requests |
| `LOG_LEVEL` | `info` | collector | `debug`\|`info`\|`warn`\|`error` |
| `HEALTH_PORT` | `8080` | collector | `/health` port |
| `FRONTEND_PORT` | `8081` | compose | host port mapped to frontend:3000 |

---

## 8. Migrations

Plain SQL in `migrations/NNN_name.sql`, applied in filename order by
`src/db/migrate.ts`, each in its own transaction, tracked in `schema_migrations`.
**Forward-only** (no `down`). The collector runs pending migrations on startup;
manual: `npm run migrate` (local) or
`docker compose run --rm collector node dist/db/migrate.js`.

| File | Change |
|---|---|
| `001_init.sql` | *(retired)* Polymarket sports/weather schema |
| `002_event_slug.sql` | *(retired)* Polymarket event slugs |
| `003_limitless.sql` | drop Polymarket tables; create `markets` / `snapshots` / `resolutions` |
| `004_markets_group_idx.sql` | partial index on `group_slug` (calibration normalization) |
| `005_stable_slug.sql` | `markets.stable_slug` + partial index |
| `006_richer_data.sql` | snapshot book levels / depth bands / effective prices / underlying; `markets` metadata columns; `trades` table; `underlying_prices` table |
| `007_retention.sql` | `resolutions(resolved_at)` index for the decimation sweep |
| `008_slippage.sql` | `snapshots.slippage` JSONB column |
| `009_gas_prices.sql` | `gas_prices` table |
| `010_equity_underlying.sql` | `underlying_prices(ts)` index (equity feed reuses the existing `source` column) |

---

## 9. Deployment

`docker-compose.yml` — three services:

- **db** — `postgres:16-alpine`, named volume `pgdata`, `pg_isready` healthcheck.
- **collector** — built from `./Dockerfile` (multi-stage: `tsc` build →
  slim runtime, non-root `node` user). Migrates on boot. `/health` published on
  `8080`. The equity feed needs a free Tiingo key (`TIINGO_API_KEY`, passed
  through from the host env / a `.env` beside the compose file); everything else
  is keyless.
- **frontend** — built from `./frontend/Dockerfile` (Next standalone, non-root).
  Reads the same `DATABASE_URL`. On two networks: the compose `default` (to reach
  `db`) and external **`proxy-net`** (shared with Nginx Proxy Manager). Host port
  `${FRONTEND_PORT:-8081}` for direct/debug access; NPM reaches it as
  `http://frontend:3000` and needs no published port. No TLS/auth in the app —
  NPM terminates TLS and gates access.

```bash
git clone <repo> && cd PolyScrape
docker network create proxy-net        # once, if the NPM stack hasn't
docker compose up -d --build
```

Local dev (needs Node 22+ and a reachable Postgres):

```bash
npm install && cp .env.example .env    # point DATABASE_URL somewhere
npm run migrate
npm run dev                            # collector, watch mode
# in frontend/: npm install && npm run dev  → http://localhost:3000
```

Tests: `npm test` (collector, `node:test` over pure helpers in `test/`).

---

## 10. Known limitations & gaps

- **Equity underlying needs a key.** With `TIINGO_API_KEY` set, `EQUITY` markets
  get `underlying_price` from Tiingo's IEX last trade *while the US market is
  open*; it's null overnight/weekends/holidays by design. Without a key,
  equities have no underlying at all. IEX is ~15% of consolidated volume — good
  enough as a reference series (the actual resolution level is in `strike_price`).
- **Deep data is capped.** `book_*`, `depth_*`, `slippage`, and `trades` are only
  collected for the `ORDERBOOK_LIMIT` soonest-to-expire markets each cycle.
  Long-dated markets get price/volume only until they enter that window.
- **Slippage assumes a clean sweep** of the stored levels at their quoted sizes —
  no taker fee, no `takerDelayMs` re-quote, no partial-fill rejection. It's an
  order-book-walk estimate, not a fill simulation. When the book can't fill a
  size it reports the VWAP of the whole book (check `depth_*` / `book_depth` for
  thinness).
- **Trade tape can miss fills** on very liquid markets that do >100 trades
  between cycles (only page 1 of `/events` is polled).
- **`strike_price` is best-effort** regex from `description`; null when the
  wording differs or the strike isn't published yet (daily markets before start).
- **CoinGecko ticker map is static** (`coingecko.ts` `CG_ID`) — a new/obscure
  coin needs a one-line addition.
- **`resolved_at` is detection time**, not the on-chain settlement time.
- **Sub-`MIN_MARKET_MINUTES` markets are not tracked** (default drops 5-/15-min
  crypto). Set `MIN_MARKET_MINUTES=0` to capture them (much higher row volume).
- **Retention thins old resolved markets.** After `RETENTION_FULL_DAYS`, a
  market's snapshots are ~`RETENTION_COARSE_MINUTES` apart, not 2 min (§4.4b).
  Sub-coarse-interval analysis on week-old resolved markets isn't possible; raise
  `RETENTION_FULL_DAYS` (more disk) for a longer full-resolution tail. Native
  monthly partitioning of `snapshots` is the next step once volume outgrows a
  single VPS — deliberately not done yet (create-copy-swap migration, no payoff
  at current scale).
- **`gas_prices` is unused.** Recorded for later cost-adjusted backtesting; no
  query or view reads it. A gas-price chart in the frontend is a possible
  follow-up.
- **Migrations are forward-only** — schema changes that need a rewrite must be
  written as additive steps.

---

## 11. Example queries

```sql
-- collection health: rows in the last hour (~ tracked * 60/SNAPSHOT_INTERVAL)
SELECT count(*), min(ts), max(ts) FROM snapshots WHERE ts > now() - interval '1 hour';

-- one market's price path + underlying + effective spread
SELECT ts, price_yes, midpoint, buy_yes_price, sell_yes_price,
       underlying_price, minutes_to_expiration
FROM snapshots WHERE slug = $1 ORDER BY ts;

-- a recurring series over time (this hour, last hour, …)
SELECT m.slug, m.expiration, r.winning_outcome
FROM markets m LEFT JOIN resolutions r USING (slug)
WHERE m.stable_slug = 'btc-hourly-price'
ORDER BY m.expiration DESC;

-- a resolved market's distance-from-strike at each snapshot
SELECT s.ts, s.price_yes, s.underlying_price, m.strike_price,
       s.underlying_price - m.strike_price AS gap
FROM snapshots s JOIN markets m USING (slug)
WHERE s.slug = $1 ORDER BY s.ts;

-- trade-flow imbalance for a market
SELECT date_trunc('minute', created_at) AS minute,
       sum(collateral) FILTER (WHERE side = 'buy')  AS buy_usdc,
       sum(collateral) FILTER (WHERE side = 'sell') AS sell_usdc
FROM trades WHERE slug = $1 GROUP BY 1 ORDER BY 1;

-- group (3-way) consistency: children's yes-prices should sum to ~1 + overround
SELECT m.group_slug, s.ts, sum(s.price_yes) AS pool
FROM snapshots s JOIN markets m USING (slug)
WHERE m.group_slug = $1
GROUP BY m.group_slug, s.ts ORDER BY s.ts DESC LIMIT 20;

-- slippage to buy $1000 of YES as expiry approaches
SELECT ts, minutes_to_expiration,
       (slippage -> 'buy' ->> '1000')::numeric AS buy_1000_slip,
       depth_5c
FROM snapshots
WHERE slug = $1 AND slippage IS NOT NULL
ORDER BY ts;

-- Base gas over the collection window
SELECT date_trunc('hour', ts) AS hour, avg(gas_price_gwei), max(gas_price_gwei)
FROM gas_prices GROUP BY 1 ORDER BY 1;

-- cost-adjust a hypothetical round trip (illustrative — gas is not wired in)
SELECT s.ts,
       (s.slippage -> 'buy'  ->> '250')::numeric
     + (s.slippage -> 'sell' ->> '250')::numeric AS book_cost_250,
       g.gas_price_gwei
FROM snapshots s JOIN gas_prices g USING (ts)
WHERE s.slug = $1 AND s.slippage IS NOT NULL
ORDER BY s.ts;
```
