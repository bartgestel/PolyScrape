import { q } from "./db";
import {
  CalibrationBin,
  CalibrationResult,
  Category,
  MarketDetail,
  MarketRow,
  OverviewRow,
  Snapshot,
} from "./types";

// ---------- overview ----------

export async function getOverview(): Promise<OverviewRow[]> {
  const rows = await q<{ category: Category; tracked: string; resolved: string }>(`
    SELECT 'sports'::text AS category,
           (SELECT count(*) FROM sports_markets)      AS tracked,
           (SELECT count(*) FROM sports_resolutions)  AS resolved
    UNION ALL
    SELECT 'weather'::text,
           (SELECT count(*) FROM weather_markets),
           (SELECT count(*) FROM weather_resolutions)
  `);
  return rows.map((r) => {
    const tracked = Number(r.tracked);
    const resolved = Number(r.resolved);
    return { category: r.category, tracked, resolved, pending: tracked - resolved };
  });
}

// ---------- market list ----------

const MARKETS_SQL: Record<Category, string> = {
  sports: `
    SELECT m.market_id, m.question, m.resolves_at, m.sport, m.home_team, m.away_team, m.game_start_time,
           s.price_yes AS last_price, s.ts AS last_ts,
           r.outcome, r.resolved_at
    FROM sports_markets m
    LEFT JOIN LATERAL (
      SELECT price_yes, ts FROM sports_snapshots
      WHERE market_id = m.market_id ORDER BY ts DESC LIMIT 1
    ) s ON true
    LEFT JOIN sports_resolutions r ON r.market_id = m.market_id
    ORDER BY m.resolves_at DESC NULLS LAST
  `,
  weather: `
    SELECT m.market_id, m.question, m.resolves_at, m.location, m.metric, m.threshold,
           s.price_yes AS last_price, s.ts AS last_ts,
           r.outcome, r.resolved_at
    FROM weather_markets m
    LEFT JOIN LATERAL (
      SELECT price_yes, ts FROM weather_snapshots
      WHERE market_id = m.market_id ORDER BY ts DESC LIMIT 1
    ) s ON true
    LEFT JOIN weather_resolutions r ON r.market_id = m.market_id
    ORDER BY m.resolves_at DESC NULLS LAST
  `,
};

export async function getMarkets(category: Category): Promise<MarketRow[]> {
  const rows = await q<MarketRow & { last_price: string | null; threshold: string | null }>(
    MARKETS_SQL[category],
  );
  return rows.map((r) => ({
    ...r,
    last_price: r.last_price == null ? null : Number(r.last_price),
    threshold: r.threshold == null ? null : Number(r.threshold),
  }));
}

// ---------- market detail ----------

async function findCategory(marketId: string): Promise<Category | null> {
  const rows = await q<{ category: Category }>(
    `SELECT 'sports'::text AS category FROM sports_markets WHERE market_id = $1
     UNION ALL
     SELECT 'weather'::text FROM weather_markets WHERE market_id = $1
     LIMIT 1`,
    [marketId],
  );
  return rows[0]?.category ?? null;
}

const SNAPSHOT_COLS: Record<Category, string> = {
  sports: "ts, price_yes, price_no, spread, volume_24h, book_depth, minutes_to_game_start",
  weather: "ts, price_yes, price_no, spread, volume_24h, book_depth",
};

export async function getMarketSnapshots(marketId: string): Promise<{ category: Category; snapshots: Snapshot[] } | null> {
  const category = await findCategory(marketId);
  if (!category) return null;
  const rows = await q<Snapshot>(
    `SELECT ${SNAPSHOT_COLS[category]} FROM ${category}_snapshots WHERE market_id = $1 ORDER BY ts`,
    [marketId],
  );
  return { category, snapshots: rows.map(numifySnapshot) };
}

function numifySnapshot(s: Snapshot): Snapshot {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    ts: s.ts,
    price_yes: n(s.price_yes),
    price_no: n(s.price_no),
    spread: n(s.spread),
    volume_24h: n(s.volume_24h),
    book_depth: n(s.book_depth),
    minutes_to_game_start: s.minutes_to_game_start == null ? null : Number(s.minutes_to_game_start),
  };
}

export async function getMarketDetail(marketId: string): Promise<MarketDetail | null> {
  const category = await findCategory(marketId);
  if (!category) return null;

  const [market] = await q<MarketRow>(
    category === "sports"
      ? `SELECT market_id, question, resolves_at, sport, home_team, away_team, game_start_time,
                NULL::numeric AS last_price, NULL::timestamptz AS last_ts, NULL::text AS outcome, NULL::timestamptz AS resolved_at
         FROM sports_markets WHERE market_id = $1`
      : `SELECT market_id, question, resolves_at, location, metric, threshold,
                NULL::numeric AS last_price, NULL::timestamptz AS last_ts, NULL::text AS outcome, NULL::timestamptz AS resolved_at
         FROM weather_markets WHERE market_id = $1`,
    [marketId],
  );
  if (!market) return null;

  const snap = await getMarketSnapshots(marketId);
  const snapshots = snap?.snapshots ?? [];

  const [resolution] = await q<MarketDetail["resolution"] & object>(
    category === "sports"
      ? `SELECT resolved_at, outcome, final_score FROM sports_resolutions WHERE market_id = $1`
      : `SELECT resolved_at, outcome, actual_measured_value FROM weather_resolutions WHERE market_id = $1`,
    [marketId],
  );

  return {
    category,
    market: {
      ...market,
      threshold: market.threshold == null ? null : Number(market.threshold),
    },
    snapshots,
    resolution: resolution
      ? {
          ...resolution,
          actual_measured_value:
            (resolution as { actual_measured_value?: unknown }).actual_measured_value == null
              ? null
              : Number((resolution as { actual_measured_value?: unknown }).actual_measured_value),
        }
      : null,
  };
}

// ---------- calibration ----------

const CALIBRATION_MIN_BIN = 5;
const CALIBRATION_TOLERANCE_HOURS = 3;

// "actual == yes" per category: sports price_yes is P(home_team); weather is a Yes/No market.
const YES_CONDITION: Record<Category, string> = {
  sports: "r.outcome = m.home_team",
  weather: "lower(r.outcome) = 'yes'",
};

export async function getCalibration(
  category: Category,
  hoursBeforeResolution: number,
): Promise<CalibrationResult> {
  const hb = Number.isFinite(hoursBeforeResolution) && hoursBeforeResolution >= 0 ? hoursBeforeResolution : 24;

  const sql = `
    WITH picked AS (
      SELECT
        r.market_id,
        (${YES_CONDITION[category]}) AS actual_yes,
        s.price_yes AS predicted
      FROM ${category}_resolutions r
      JOIN ${category}_markets m ON m.market_id = r.market_id
      JOIN LATERAL (
        SELECT ss.price_yes,
               abs(extract(epoch FROM (
                 ss.ts - (COALESCE(m.resolves_at, r.resolved_at) - ($1 || ' hours')::interval)
               ))) AS dist_s
        FROM ${category}_snapshots ss
        WHERE ss.market_id = r.market_id AND ss.price_yes IS NOT NULL
        ORDER BY dist_s ASC
        LIMIT 1
      ) s ON s.dist_s <= $2 * 3600
      WHERE COALESCE(m.resolves_at, r.resolved_at) IS NOT NULL
    ),
    binned AS (
      SELECT
        LEAST(width_bucket(predicted, 0, 1, 10), 10) AS bin,
        predicted,
        CASE WHEN actual_yes THEN 1.0 ELSE 0.0 END AS actual
      FROM picked
      WHERE predicted >= 0 AND predicted <= 1
    )
    SELECT bin,
           count(*)::int          AS n,
           avg(predicted)::float  AS predicted_mean,
           avg(actual)::float     AS actual_freq
    FROM binned
    GROUP BY bin
    ORDER BY bin
  `;

  const [{ resolved }] = await q<{ resolved: string }>(
    `SELECT count(*) AS resolved FROM ${category}_resolutions`,
  );
  const rows = await q<{ bin: number; n: number; predicted_mean: number; actual_freq: number }>(sql, [
    String(hb),
    CALIBRATION_TOLERANCE_HOURS,
  ]);

  const matchedMarkets = rows.reduce((a, r) => a + r.n, 0);
  const bins: CalibrationBin[] = rows
    .filter((r) => r.n >= CALIBRATION_MIN_BIN)
    .map((r) => ({
      bin_mid: (r.bin - 0.5) / 10,
      n: r.n,
      predicted_mean: r.predicted_mean,
      actual_freq: r.actual_freq,
    }));

  return {
    category,
    hoursBeforeResolution: hb,
    matchToleranceHours: CALIBRATION_TOLERANCE_HOURS,
    minBinSize: CALIBRATION_MIN_BIN,
    resolvedMarkets: Number(resolved),
    matchedMarkets,
    bins,
  };
}
