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
| `markets` | one row per tracked binary market, keyed by Limitless `slug` |
| `snapshots` | one row per market per snapshot cycle |
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
  `price_yes` / `price_no` / `volume` across the whole tracked set, then pulls the
  order book (`spread`, `midpoint`, `best_bid`/`best_ask`, `book_depth` in USDC)
  for the `ORDERBOOK_LIMIT` soonest-to-expire markets only. This keeps request
  volume under the Limitless (Cloudflare) rate limit.
- **Resolution** — a tracked market that has dropped out of the active list, or
  whose `winningOutcomeIndex` is set, is confirmed with a single
  `GET /markets/:slug` and recorded (`winning_outcome_index` 0 = Yes, 1 = No).

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
| `ORDERBOOK_LIMIT` | `100` | order books fetched per snapshot cycle, soonest-to-expire first. `0` disables |
| `LIMITLESS_RPS` | `6` | process-wide cap on requests/sec to the API (Cloudflare 429s bursts) |
| `HTTP_CONCURRENCY` | `4` | max in-flight requests |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `HEALTH_PORT` | `8080` | port for the internal `/health` endpoint |

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
  limitless.ts     Limitless API client: active-markets pagination, market detail, order book, group flattening
  collector.ts     discovery / bulk snapshot / resolution
  health.ts        /health endpoint
  index.ts         migrate, then three setInterval loops
migrations/     001/002 retired Polymarket schema; 003 Limitless schema; 004/005 indexes + stable_slug

frontend/          read-only Next.js viewer (own package.json / Dockerfile)
  src/lib/         pg pool (read-only) + all SQL + shared types
  src/app/         pages (overview, markets, markets/[slug], calibration) + /api routes
  src/components/  Nav, MarketTable, PriceChart, CalibrationChart
```
