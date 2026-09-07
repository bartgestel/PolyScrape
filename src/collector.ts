// Generic collector: discovery upsert, snapshot polling, resolution detection.
// Category-agnostic — all per-category behaviour comes from the Category config.

import { bookDepth } from "./clob";
import { bookTokenId, Category, NormalizedMarket, TrackedMarket } from "./categories";
import { query } from "./db";
import { fetchMarketsByCondition, GammaMarket, resolvedOutcome } from "./gamma";
import { chunk, mapLimit } from "./http";
import { logger } from "./logger";

const CONDITION_BATCH = 50;

function placeholders(rows: number, cols: number): string {
  const chunks: string[] = [];
  let p = 1;
  for (let r = 0; r < rows; r++) {
    chunks.push("(" + Array.from({ length: cols }, () => `$${p++}`).join(",") + ")");
  }
  return chunks.join(",");
}

// --- Discovery ---------------------------------------------------------------

export async function runDiscovery(cat: Category): Promise<number> {
  const markets = await cat.discover();
  if (markets.length === 0) return 0;

  const cols = ["market_id", "question", "resolves_at", ...cat.marketExtraColumns];
  const updates = cols
    .filter((c) => c !== "market_id")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");

  const toRow = (m: NormalizedMarket) => [
    m.market_id,
    m.question,
    m.resolves_at,
    ...cat.marketExtraColumns.map((c) => m.extra[c] ?? null),
  ];

  for (const batch of chunk(markets, 500)) {
    const values = batch.flatMap(toRow);
    await query(
      `INSERT INTO ${cat.marketsTable} (${cols.join(",")})
       VALUES ${placeholders(batch.length, cols.length)}
       ON CONFLICT (market_id) DO UPDATE SET ${updates}`,
      values,
    );
  }
  logger.info("discovery upserted", { category: cat.name, markets: markets.length });
  return markets.length;
}

// --- Shared: load tracked (unresolved) markets -----------------------------

async function trackedMarkets(cat: Category, onlyDue: boolean): Promise<TrackedMarket[]> {
  const dueClause = onlyDue ? "AND (m.resolves_at IS NULL OR m.resolves_at < now())" : "";
  const rows = await query<TrackedMarket>(
    `SELECT m.* FROM ${cat.marketsTable} m
     WHERE NOT EXISTS (SELECT 1 FROM ${cat.resolutionsTable} r WHERE r.market_id = m.market_id)
     ${dueClause}`,
  );
  return rows;
}

async function gammaByCondition(ids: string[]): Promise<Map<string, GammaMarket>> {
  const map = new Map<string, GammaMarket>();
  for (const ids50 of chunk(ids, CONDITION_BATCH)) {
    try {
      for (const gm of await fetchMarketsByCondition(ids50)) map.set(gm.conditionId, gm);
    } catch (err) {
      logger.warn("gamma batch fetch failed", { err });
    }
  }
  return map;
}

// --- Snapshot --------------------------------------------------------------

export async function runSnapshot(cat: Category): Promise<number> {
  const tracked = await trackedMarkets(cat, false);
  if (tracked.length === 0) return 0;

  const gamma = await gammaByCondition(tracked.map((m) => m.market_id));
  const ts = new Date();

  const rows = await mapLimit(tracked, async (m) => {
    const gm = gamma.get(m.market_id);
    if (!gm) return null;
    const { yes, no } = cat.mapPrices(m, gm);
    const spread =
      gm.spread ??
      (gm.bestAsk != null && gm.bestBid != null ? Number((gm.bestAsk - gm.bestBid).toFixed(6)) : null);
    const depth = await bookDepth(bookTokenId(gm));
    const extra = cat.snapshotExtra(m, gm);
    return {
      base: [m.market_id, ts, yes, no, spread, gm.volume24hr ?? null, depth],
      extra: cat.snapshotExtraColumns.map((c) => extra[c] ?? null),
    };
  });

  const valid = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  if (valid.length === 0) return 0;

  const cols = [
    "market_id", "ts", "price_yes", "price_no", "spread", "volume_24h", "book_depth",
    ...cat.snapshotExtraColumns,
  ];
  for (const batch of chunk(valid, 500)) {
    const values = batch.flatMap((r) => [...r.base, ...r.extra]);
    await query(
      `INSERT INTO ${cat.snapshotsTable} (${cols.join(",")})
       VALUES ${placeholders(batch.length, cols.length)}`,
      values,
    );
  }
  logger.info("snapshots written", { category: cat.name, markets: valid.length });
  return valid.length;
}

// --- Resolution ----------------------------------------------------------

export async function runResolution(cat: Category): Promise<number> {
  const tracked = await trackedMarkets(cat, true);
  if (tracked.length === 0) return 0;

  const gamma = await gammaByCondition(tracked.map((m) => m.market_id));
  const resolved = tracked
    .map((m) => ({ m, gm: gamma.get(m.market_id) }))
    .filter((x): x is { m: TrackedMarket; gm: GammaMarket } => !!x.gm && resolvedOutcome(x.gm!) !== null);

  if (resolved.length === 0) return 0;

  const cols = ["market_id", "resolved_at", "outcome", ...cat.resolutionExtraColumns];

  await mapLimit(
    resolved,
    async ({ m, gm }) => {
      const outcome = resolvedOutcome(gm)!;
      let extra: Record<string, unknown> = {};
      try {
        extra = await cat.backfillResolution(m, outcome);
      } catch (err) {
        logger.warn("resolution backfill failed", { category: cat.name, market: m.market_id, err });
      }
      const resolvedAt = gm.closedTime ? new Date(gm.closedTime) : new Date();
      const values = [m.market_id, resolvedAt, outcome, ...cat.resolutionExtraColumns.map((c) => extra[c] ?? null)];
      await query(
        `INSERT INTO ${cat.resolutionsTable} (${cols.join(",")})
         VALUES (${values.map((_, i) => `$${i + 1}`).join(",")})
         ON CONFLICT (market_id) DO NOTHING`,
        values,
      );
      logger.info("market resolved", { category: cat.name, market: m.market_id, outcome });
    },
    4,
  );
  return resolved.length;
}
