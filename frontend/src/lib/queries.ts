import { q } from "./db";
import {
  CalibrationBin,
  CalibrationResult,
  MarketDetail,
  MarketRow,
  MarketTypeFilter,
  OverviewSummary,
  Snapshot,
} from "./types";

const num = (v: unknown): number | null => (v == null ? null : Number(v));

// ---------- overview ----------

export async function getOverview(): Promise<OverviewSummary> {
  const [totals] = await q<{ total: string; resolved: string }>(`
    SELECT (SELECT count(*) FROM markets)     AS total,
           (SELECT count(*) FROM resolutions) AS resolved
  `);
  const byCategory = await q<{ category: string; tracked: string; resolved: string }>(`
    SELECT cat AS category,
           count(*)                                   AS tracked,
           count(r.slug)                              AS resolved
    FROM markets m
    CROSS JOIN LATERAL unnest(
      CASE WHEN cardinality(m.categories) = 0 THEN ARRAY['(uncategorized)'] ELSE m.categories END
    ) AS cat
    LEFT JOIN resolutions r ON r.slug = m.slug
    GROUP BY cat
    ORDER BY count(*) DESC
  `);
  const total = Number(totals.total);
  const resolved = Number(totals.resolved);
  return {
    totalMarkets: total,
    resolved,
    pending: total - resolved,
    byCategory: byCategory.map((c) => ({
      category: c.category,
      tracked: Number(c.tracked),
      resolved: Number(c.resolved),
    })),
  };
}

export async function getCategories(): Promise<string[]> {
  const rows = await q<{ category: string }>(
    `SELECT DISTINCT unnest(categories) AS category FROM markets ORDER BY 1`,
  );
  return rows.map((r) => r.category);
}

// ---------- market list ----------

export async function getMarkets(category: string | null): Promise<MarketRow[]> {
  const rows = await q<MarketRow & { last_price: string | null }>(
    `
    SELECT m.slug, m.title, m.categories, m.market_type, m.group_slug, m.stable_slug,
           m.expiration, m.first_seen,
           s.price_yes AS last_price, s.ts AS last_ts,
           r.winning_outcome, r.winning_outcome_index, r.resolved_at
    FROM markets m
    LEFT JOIN LATERAL (
      SELECT price_yes, ts FROM snapshots WHERE slug = m.slug ORDER BY ts DESC LIMIT 1
    ) s ON true
    LEFT JOIN resolutions r ON r.slug = m.slug
    ${category ? "WHERE $1 = ANY(m.categories)" : ""}
    ORDER BY m.expiration DESC NULLS LAST
    `,
    category ? [category] : [],
  );
  return rows.map((r) => ({ ...r, last_price: num(r.last_price) }));
}

// ---------- market detail ----------

export async function getMarketSnapshots(slug: string): Promise<Snapshot[] | null> {
  const exists = await q(`SELECT 1 FROM markets WHERE slug = $1`, [slug]);
  if (exists.length === 0) return null;
  const rows = await q<Record<string, unknown>>(
    `SELECT ts, price_yes, price_no, midpoint, best_bid, best_ask, spread,
            last_trade_price, volume, book_depth, minutes_to_expiration,
            depth_1c, depth_2c, depth_5c, buy_yes_price, sell_yes_price, underlying_price,
            book_bids, book_asks
     FROM snapshots WHERE slug = $1 ORDER BY ts`,
    [slug],
  );
  return rows.map((s) => ({
    ts: s.ts as string,
    price_yes: num(s.price_yes),
    price_no: num(s.price_no),
    midpoint: num(s.midpoint),
    best_bid: num(s.best_bid),
    best_ask: num(s.best_ask),
    spread: num(s.spread),
    last_trade_price: num(s.last_trade_price),
    volume: num(s.volume),
    book_depth: num(s.book_depth),
    minutes_to_expiration: s.minutes_to_expiration == null ? null : Number(s.minutes_to_expiration),
    depth_1c: num(s.depth_1c),
    depth_2c: num(s.depth_2c),
    depth_5c: num(s.depth_5c),
    buy_yes_price: num(s.buy_yes_price),
    sell_yes_price: num(s.sell_yes_price),
    underlying_price: num(s.underlying_price),
    book_bids: (s.book_bids as Snapshot["book_bids"]) ?? null,
    book_asks: (s.book_asks as Snapshot["book_asks"]) ?? null,
  }));
}

export async function getMarketTrades(slug: string, limit = 100): Promise<import("./types").Trade[]> {
  const rows = await q<Record<string, unknown>>(
    `SELECT created_at, outcome, side, price, size, collateral, taker
     FROM trades WHERE slug = $1 ORDER BY created_at DESC LIMIT $2`,
    [slug, limit],
  );
  return rows.map((t) => ({
    created_at: t.created_at as string,
    outcome: (t.outcome as string) ?? null,
    side: (t.side as string) ?? null,
    price: num(t.price),
    size: num(t.size),
    collateral: num(t.collateral),
    taker: (t.taker as string) ?? null,
  }));
}

export async function getMarketDetail(slug: string): Promise<MarketDetail | null> {
  const [market] = await q<MarketDetail["market"]>(
    `SELECT slug, title, categories, market_type, trade_type, group_slug, stable_slug,
            condition_id, source_created_at, expiration, first_seen,
            description, creator_name, automation_type, frequency, is_rewardable,
            oracle_ticker, oracle_asset_type, oracle_source, strike_price,
            max_spread, daily_reward, rebate_rate, creator_fee_pct, min_size,
            NULL::numeric AS last_price, NULL::timestamptz AS last_ts,
            NULL::text AS winning_outcome, NULL::int AS winning_outcome_index, NULL::timestamptz AS resolved_at
     FROM markets WHERE slug = $1`,
    [slug],
  );
  if (!market) return null;
  const mm = market as unknown as Record<string, unknown>;
  for (const k of ["strike_price", "max_spread", "daily_reward", "rebate_rate", "creator_fee_pct", "min_size"]) {
    mm[k] = num(mm[k]);
  }

  const [snapshots, trades] = await Promise.all([getMarketSnapshots(slug), getMarketTrades(slug)]);
  const [resolution] = await q<MarketDetail["resolution"] & object>(
    `SELECT resolved_at, winning_outcome, winning_outcome_index, status
     FROM resolutions WHERE slug = $1`,
    [slug],
  );
  return { market, snapshots: snapshots ?? [], trades, resolution: resolution ?? null };
}

// ---------- calibration ----------

const MIN_BIN = 5;
const TOLERANCE_HOURS = 3;

export async function getCalibration(
  category: string | null,
  hoursBeforeExpiration: number,
  marketType: MarketTypeFilter = "all",
): Promise<CalibrationResult> {
  const hb =
    Number.isFinite(hoursBeforeExpiration) && hoursBeforeExpiration >= 0 ? hoursBeforeExpiration : 24;

  const params: unknown[] = [String(hb), TOLERANCE_HOURS];
  const catFilter = category ? `AND $${params.push(category)} = ANY(m.categories)` : "";
  const typeFilter =
    marketType === "standalone" ? "AND m.group_slug IS NULL" :
    marketType === "group" ? "AND m.group_slug IS NOT NULL" : "";

  // For group markets the predicted probability is the child's price divided by
  // the sum of the group's children prices at the same snapshot (all markets in
  // a cycle share one ts), so each event's pool sums to 1 and the overround is
  // removed. Standalone markets use price_yes directly.
  const rows = await q<{ bin: number; n: number; predicted_mean: number; actual_freq: number }>(
    `
    WITH picked AS (
      SELECT r.slug, m.group_slug,
             (r.winning_outcome_index = 0) AS actual_yes,
             s.price_yes, s.ts AS pick_ts
      FROM resolutions r
      JOIN markets m ON m.slug = r.slug
      JOIN LATERAL (
        SELECT ss.price_yes, ss.ts,
               abs(extract(epoch FROM (ss.ts - (m.expiration - ($1 || ' hours')::interval)))) AS dist_s
        FROM snapshots ss
        WHERE ss.slug = r.slug AND ss.price_yes IS NOT NULL
        ORDER BY dist_s ASC
        LIMIT 1
      ) s ON s.dist_s <= $2 * 3600
      WHERE m.expiration IS NOT NULL ${catFilter} ${typeFilter}
    ),
    normed AS (
      SELECT p.actual_yes,
             CASE WHEN p.group_slug IS NULL THEN p.price_yes
                  ELSE p.price_yes / NULLIF((
                    SELECT sum(ss.price_yes)
                    FROM markets m2 JOIN snapshots ss ON ss.slug = m2.slug AND ss.ts = p.pick_ts
                    WHERE m2.group_slug = p.group_slug
                  ), 0)
             END AS predicted
      FROM picked p
    ),
    binned AS (
      SELECT LEAST(width_bucket(predicted, 0, 1, 10), 10) AS bin,
             predicted,
             CASE WHEN actual_yes THEN 1.0 ELSE 0.0 END AS actual
      FROM normed
      WHERE predicted >= 0 AND predicted <= 1
    )
    SELECT bin, count(*)::int AS n, avg(predicted)::float AS predicted_mean, avg(actual)::float AS actual_freq
    FROM binned GROUP BY bin ORDER BY bin
    `,
    params,
  );

  const rparams: unknown[] = [];
  const rcat = category ? `AND $${rparams.push(category)} = ANY(m.categories)` : "";
  const rtype =
    marketType === "standalone" ? "AND m.group_slug IS NULL" :
    marketType === "group" ? "AND m.group_slug IS NOT NULL" : "";
  const [{ resolved }] = await q<{ resolved: string }>(
    `SELECT count(*) AS resolved FROM resolutions r JOIN markets m ON m.slug = r.slug WHERE true ${rcat} ${rtype}`,
    rparams,
  );

  const matchedMarkets = rows.reduce((a, r) => a + r.n, 0);
  const bins: CalibrationBin[] = rows
    .filter((r) => r.n >= MIN_BIN)
    .map((r) => ({
      bin_mid: (r.bin - 0.5) / 10,
      n: r.n,
      predicted_mean: r.predicted_mean,
      actual_freq: r.actual_freq,
    }));

  return {
    category,
    marketType,
    hoursBeforeExpiration: hb,
    matchToleranceHours: TOLERANCE_HOURS,
    minBinSize: MIN_BIN,
    resolvedMarkets: Number(resolved),
    matchedMarkets,
    bins,
  };
}
