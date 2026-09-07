# PolyScrape

Read-only market-data collector for Polymarket **sports** and **weather** markets.
Discovers markets, snapshots price / spread / volume / book depth on an interval,
records resolutions with final outcome, stores everything in Postgres. No trading,
no auth, no private keys.

## What it collects

| Table | Rows |
|---|---|
| `sports_markets` / `weather_markets` | one row per tracked binary market (Polymarket `conditionId`) |
| `sports_snapshots` / `weather_snapshots` | one row per market per snapshot cycle |
| `sports_resolutions` / `weather_resolutions` | one row per market once it resolves; collector then stops snapshotting it |

- **Sports** discovery walks the Gamma `/sports` league list (~465 leagues) and tracks
  only the **full-game moneyline** market per game (question == event title) with a
  `gameStartTime` in `[now-2d, now+21d]` — real upcoming/live games, not season futures
  and not the ~150 prop markets (spreads/totals/quarters/player props) each game spawns.
  For sports, `price_yes` = P(`home_team`), `price_no` = P(`away_team`). 3-way (draw)
  markets are skipped. `final_score` is backfilled best-effort from ESPN's public API.
- **Weather** discovery tracks everything under the Gamma `weather` tag (id 84) —
  daily temperature, rain, plus climate/natural-disaster markets. `actual_measured_value`
  is backfilled best-effort from Open-Meteo for temperature/precipitation markets
  (°F when the question is stated in °F, otherwise °C; mm for precip). Other weather
  market types record the outcome only.

Metadata fields (`sport`, `home_team`, `location`, `metric`, `threshold`, …) are
extracted from question text with heuristics — `question` is always stored verbatim
for re-parsing later.

## Configuration

Copy `.env.example` to `.env` and adjust. Every var:

| Var | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres connection string |
| `POLYMARKET_CLOB_HOST` | `https://clob.polymarket.com` | CLOB REST host (book depth) |
| `POLYMARKET_GAMMA_HOST` | `https://gamma-api.polymarket.com` | Gamma host (discovery, prices, resolution) |
| `SNAPSHOT_INTERVAL_MINUTES` | `2` | how often to snapshot every tracked market |
| `DISCOVERY_INTERVAL_HOURS` | `3` | how often to rescan for new markets |
| `RESOLUTION_CHECK_INTERVAL_MINUTES` | `20` | how often to check past-due markets for resolution |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `HEALTH_PORT` | `8080` | port for the internal `/health` endpoint |
| `HTTP_CONCURRENCY` | `8` | max concurrent outbound API calls per job |

## Local development

Needs Node 22+ and a Postgres you can reach.

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your Postgres
npm run migrate               # create the schema
npm run dev                   # watch-mode; runs discovery once then the loops
```

Run the unit tests (parsing + resolution-detection logic):

```bash
npm test
```

## Migrations

Plain numbered SQL in `migrations/`, applied by a small runner
(`src/db/migrate.ts`) that tracks applied files in a `schema_migrations` table.
Forward-only. The collector runs pending migrations automatically on startup;
to run them by hand:

```bash
npm run migrate        # local (tsx)
```

```bash
docker compose run --rm collector node dist/db/migrate.js   # against the compose DB
```

To add a migration, drop `migrations/002_whatever.sql` in place — it runs on next start.

## Deploy on a VPS

```bash
git clone <this repo> && cd PolyScrape
cp .env.example .env          # optional: only needed to override the compose defaults
docker compose up -d --build
```

`docker-compose.yml` starts three services:

- `db` — `postgres:16-alpine`, data in the named volume `pgdata`
- `collector` — multi-stage build, runs as non-root, migrates on boot, then loops
- `frontend` — read-only data viewer (see [Frontend](#frontend-data-viewer) below)

The collector's `DATABASE_URL` is set in `docker-compose.yml` to point at the `db`
service; the other intervals are set there too — edit and `docker compose up -d`
to change them. The `/health` endpoint is published on `${HEALTH_PORT}` (8080 by
default — change the left side of the `ports:` mapping if 8080 is taken on the host).

```bash
docker compose logs -f collector      # structured JSON logs
docker compose ps                     # collector shows (healthy) once snapshots are flowing
curl localhost:8080/health            # {"healthy":true,...}
```

`/health` reports unhealthy if no snapshot cycle has completed in ~3 intervals;
Docker restarts the container on repeated failures (`restart: unless-stopped`).

## Check it's collecting

```bash
docker compose exec db psql -U polyscrape -d polyscrape
```

```sql
-- tracked markets and how many are still unresolved
SELECT
  (SELECT count(*) FROM sports_markets)  AS sports_markets,
  (SELECT count(*) FROM weather_markets) AS weather_markets,
  (SELECT count(*) FROM sports_resolutions)  AS sports_resolved,
  (SELECT count(*) FROM weather_resolutions) AS weather_resolved;

-- snapshot volume over the last hour (should be ~ markets * 60/SNAPSHOT_INTERVAL_MINUTES)
SELECT count(*) AS snaps_last_hour,
       min(ts) AS oldest, max(ts) AS newest
FROM weather_snapshots
WHERE ts > now() - interval '1 hour';

-- latest price for a few active weather markets
SELECT m.question, s.price_yes, s.spread, s.volume_24h, s.book_depth, s.ts
FROM weather_snapshots s
JOIN weather_markets m USING (market_id)
WHERE s.ts > now() - interval '10 minutes'
ORDER BY s.ts DESC
LIMIT 20;

-- price path for one market from open to resolution
SELECT s.ts, s.price_yes, s.minutes_to_game_start
FROM sports_snapshots s
WHERE s.market_id = '<conditionId>'
ORDER BY s.ts;

-- resolved markets with the recorded outcome
SELECT m.question, r.outcome, r.final_score, r.resolved_at
FROM sports_resolutions r JOIN sports_markets m USING (market_id)
ORDER BY r.resolved_at DESC LIMIT 20;
```

## Frontend (data viewer)

A read-only Next.js app in [`frontend/`](frontend/) — its own `package.json`, its own
Dockerfile, no shared code with the collector. It never writes: the `pg` pool is pinned
to `default_transaction_read_only=on`.

**Views**

- **Overview** (`/`) — markets tracked, resolved vs pending, per category.
- **Market browser** (`/markets?category=sports|weather`) — filterable/sortable table
  (text, sport/metric, resolved state); row → detail.
- **Market detail** (`/markets/<market_id>`) — `price_yes` line chart over the snapshot
  history; if resolved, a marker at the resolution time plus outcome / final score /
  measured value next to the final market price. Spread and 24h volume in a companion chart.
- **Calibration** (`/calibration`) — resolved markets bucketed by market-implied P(yes) at
  a configurable lead time before `resolves_at` (default 24h), plotted as predicted
  probability vs. actual outcome frequency against the diagonal. Ten 0.1-wide bins; the
  snapshot used is the one nearest `resolves_at − hoursBeforeResolution` within ±3h; bins
  with fewer than 5 markets are hidden. For sports, "yes" = the home team; for weather,
  the market's Yes outcome.

**API** (read-only JSON, same data the pages use): `GET /api/overview`,
`GET /api/markets?category=`, `GET /api/markets/:id/snapshots`,
`GET /api/calibration?category=&hoursBeforeResolution=`.

**Indexes** — the calibration and detail queries lean on `(market_id, ts)` on both
snapshot tables; `migrations/001_init.sql` already creates those, so the viewer adds no
migration of its own.

### Local dev

```bash
cd frontend
npm install
cp .env.example .env          # point DATABASE_URL at the same Postgres the collector uses
npm run dev                   # http://localhost:3000
```

If you don't have Postgres locally, borrow the compose one: `docker compose up -d db`
(add `ports: ["5432:5432"]` to the `db` service first — it's unpublished by default).

### In the VPS stack

`docker compose up -d --build` builds and starts `frontend` alongside `db` and
`collector`. It reads the same `DATABASE_URL` (pointing at the `db` service) and is
attached to two networks: the stack's internal `default` (to reach `db`) and the
external **`proxy-net`**, shared with your Nginx Proxy Manager.

Create that shared network once on the host (NPM's own stack may already have):

```bash
docker network create proxy-net
```

Then in Nginx Proxy Manager add a Proxy Host pointing at `frontend` port `3000` (both
containers are on `proxy-net`, so NPM resolves the service by name — no published port
needed). For direct/debug access the container also maps to the host on
`${FRONTEND_PORT:-8081}`. No TLS or auth in the app — NPM terminates TLS and can gate access.

## Layout

```
src/
  config.ts        env parsing
  logger.ts        JSON-to-stdout logging
  http.ts          fetch wrapper (UA header, retry, 429 backoff) + concurrency limiter
  gamma.ts         Gamma API: discovery, live market state, resolution detection
  clob.ts          CLOB REST: order-book depth
  parse.ts         text-extraction heuristics (pure, unit-tested)
  categories.ts    per-category config: sports / weather discovery + backfill
  collector.ts     generic discovery-upsert / snapshot / resolution (category-agnostic)
  scores/espn.ts   sports final-score backfill
  scores/weather.ts weather measured-value backfill (Open-Meteo)
  health.ts        /health endpoint
  index.ts         migrate, then three setInterval loops
migrations/001_init.sql

frontend/          read-only Next.js viewer (own package.json / Dockerfile)
  src/lib/         pg pool (read-only) + all SQL + shared types
  src/app/         pages (overview, markets, markets/[id], calibration) + /api routes
  src/components/  Nav, MarketTable, PriceChart, CalibrationChart
```
