// Discovery / snapshot / resolution against Limitless Exchange.
//
// Every category is collected the same way. Price + volume for the whole tracked
// set come from ONE bulk fetch of /markets/active per cycle (~30 requests);
// order-book depth is polled for only the N soonest-to-expire markets. This
// keeps request volume well under Limitless's Cloudflare rate limit.

import { fetchBaseGasGwei } from "./base";
import { config } from "./config";
import { fetchUnderlyingPrices } from "./coingecko";
import { query } from "./db";
import { fetchEquityPrices } from "./tiingo";
import { chunk, mapLimit } from "./http";
import {
  expirationMs,
  fetchActiveMarkets,
  fetchMarket,
  fetchMarketEvents,
  fetchOrderBook,
  FlatMarket,
  flattenMarkets,
  marketFrequency,
  OrderBook,
  parseStrike,
} from "./limitless";
import { logger } from "./logger";
import { computeSlippage, Level } from "./slippage";

const nn = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function placeholders(rows: number, cols: number): string {
  const parts: string[] = [];
  let p = 1;
  for (let r = 0; r < rows; r++) {
    parts.push("(" + Array.from({ length: cols }, () => `$${p++}`).join(",") + ")");
  }
  return parts.join(",");
}
const toTs = (ms: number | null | undefined) => (ms == null ? null : new Date(ms));

async function activeBySlug(): Promise<Map<string, FlatMarket>> {
  const flat = flattenMarkets(await fetchActiveMarkets());
  const map = new Map<string, FlatMarket>();
  for (const fm of flat) if (!map.has(fm.m.slug)) map.set(fm.m.slug, fm);
  return map;
}

// --- Discovery -------------------------------------------------------------

const MARKET_COLS = [
  "slug", "market_id", "condition_id", "title", "categories", "market_type",
  "trade_type", "group_slug", "stable_slug", "yes_token_id", "no_token_id",
  "source_created_at", "start_at", "expiration",
  "description", "creator_name", "creator_address", "automation_type", "frequency",
  "is_rewardable", "tags", "oracle_ticker", "oracle_asset_type", "oracle_source",
  "strike_price", "max_spread", "daily_reward", "rebate_rate", "creator_fee_pct", "min_size",
];

/** Upsert every currently-active market that still has >= MIN_MARKET_MINUTES to run. */
export async function upsertActive(flat: FlatMarket[]): Promise<number> {
  const now = Date.now();
  const minMs = config.minMarketMinutes * 60_000;
  const rows = flat
    .filter(({ m }) => {
      const exp = expirationMs(m);
      return exp == null || exp - now >= minMs;
    })
    .map(({ m, groupSlug, title }) => {
      const s = m.settings ?? {};
      return [
        m.slug, m.id ?? null, m.conditionId ?? null, title, m.categories ?? [],
        groupSlug ? "group-child" : (m.marketType ?? "single"),
        m.tradeType ?? null, groupSlug, m.stableSlug ?? null,
        m.tokens?.yes ?? null, m.tokens?.no ?? null,
        m.createdAt ? new Date(m.createdAt) : null,
        m.startAt ? new Date(m.startAt) : null,
        toTs(expirationMs(m)),
        m.description ?? null, m.creator?.name ?? null, m.creator?.address ?? null,
        m.automationType ?? null, marketFrequency(m),
        m.isRewardable ?? null, m.tags ?? [],
        m.priceOracleMetadata?.ticker ?? null, m.priceOracleMetadata?.assetType ?? null,
        m.priceOracleMetadata?.chartSource ?? null,
        parseStrike(m.description),
        nn(s.maxSpread), nn(s.dailyReward), nn(s.rebateRate), nn(s.creatorFeePct),
        nn(s.minSize) == null ? null : (nn(s.minSize) as number) / 1e6,
      ];
    });
  if (rows.length === 0) return 0;

  const updates = MARKET_COLS.filter((c) => c !== "slug").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  for (const batch of chunk(rows, 400)) {
    await query(
      `INSERT INTO markets (${MARKET_COLS.join(",")})
       VALUES ${placeholders(batch.length, MARKET_COLS.length)}
       ON CONFLICT (slug) DO UPDATE SET ${updates}`,
      batch.flat(),
    );
  }
  return rows.length;
}

export async function runDiscovery(): Promise<number> {
  const n = await upsertActive([...(await activeBySlug()).values()]);
  logger.info("discovery upserted", { markets: n });
  return n;
}

// --- shared ------------------------------------------------------------

type TrackedRow = { slug: string; expiration: Date | null } & Record<string, unknown>;

async function trackedMarkets(onlyDue: boolean): Promise<TrackedRow[]> {
  const due = onlyDue ? "AND (m.expiration IS NULL OR m.expiration < now())" : "";
  return query<TrackedRow>(
    `SELECT m.slug, m.expiration FROM markets m
     WHERE NOT EXISTS (SELECT 1 FROM resolutions r WHERE r.slug = m.slug) ${due}`,
  );
}

async function writeResolutions(items: { slug: string; idx: number; status: string | null }[]): Promise<void> {
  for (const batch of chunk(items, 400)) {
    await query(
      `INSERT INTO resolutions (slug, winning_outcome_index, winning_outcome, status)
       VALUES ${placeholders(batch.length, 4)}
       ON CONFLICT (slug) DO NOTHING`,
      batch.flatMap((r) => [r.slug, r.idx, r.idx === 0 ? "Yes" : "No", r.status]),
    );
  }
}

/** Confirm resolution for slugs that vanished from the active list. Capped. */
async function resolveMissing(slugs: string[], cap: number): Promise<number> {
  const take = slugs.slice(0, cap);
  const found = (
    await mapLimit(take, async (slug) => {
      const m = await fetchMarket(slug);
      return m && m.winningOutcomeIndex != null
        ? { slug, idx: m.winningOutcomeIndex, status: m.status ?? null }
        : null;
    })
  ).filter((x): x is { slug: string; idx: number; status: string | null } => x !== null);
  if (found.length) await writeResolutions(found);
  return found.length;
}

interface BookMetrics {
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
  midpoint: number | null;
  last_trade_price: number | null;
  book_depth: number | null;
  book_bids: string | null;
  book_asks: string | null;
  depth_1c: number | null;
  depth_2c: number | null;
  depth_5c: number | null;
  slippage: string | null;
}
const EMPTY_BOOK: BookMetrics = {
  best_bid: null, best_ask: null, spread: null, midpoint: null, last_trade_price: null,
  book_depth: null, book_bids: null, book_asks: null,
  depth_1c: null, depth_2c: null, depth_5c: null, slippage: null,
};

function bookMetrics(book: OrderBook | null): BookMetrics {
  if (!book) return EMPTY_BOOK;
  // level.size is outcome tokens (6-decimals); USDC notional per level = price * size.
  const toLevel = (levels: { price: number; size: number }[]): Level[] =>
    levels.map((l) => ({ price: l.price, size: Number(l.size) / 1e6 }));
  const bids = toLevel(book.bids ?? []).sort((a, b) => b.price - a.price);
  const asks = toLevel(book.asks ?? []).sort((a, b) => a.price - b.price);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const mid = book.adjustedMidpoint ?? book.midpoint ??
    (bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null);
  const within = (band: number) =>
    mid == null ? null :
    [...bids, ...asks].reduce((a, l) => (Math.abs(l.price - mid) <= band ? a + l.size : a), 0) || null;
  const total = [...bids, ...asks].reduce((a, l) => a + l.size, 0);
  return {
    best_bid: bestBid,
    best_ask: bestAsk,
    spread: bestBid != null && bestAsk != null ? Number((bestAsk - bestBid).toFixed(6)) : null,
    midpoint: mid,
    last_trade_price: book.lastTradePrice ?? null,
    book_depth: total || null,
    book_bids: bids.length ? JSON.stringify(bids.slice(0, 10)) : null,
    book_asks: asks.length ? JSON.stringify(asks.slice(0, 10)) : null,
    depth_1c: within(0.01),
    depth_2c: within(0.02),
    depth_5c: within(0.05),
    slippage: (() => {
      const s = computeSlippage(bids, asks, mid, config.slippageOrderSizesUsdc);
      return s ? JSON.stringify(s) : null;
    })(),
  };
}

/**
 * Fetch reference spot for every crypto (CoinGecko) and equity (Tiingo) oracle
 * ticker in the tracked set; persist to underlying_prices and return a
 * ticker -> price map for the snapshot rows.
 */
async function fetchUnderlyingMap(
  present: TrackedRow[],
  map: Map<string, FlatMarket>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const crypto = new Set<string>();
  const equity = new Set<string>();
  for (const t of present) {
    const om = map.get(t.slug)!.m.priceOracleMetadata;
    if (!om?.ticker) continue;
    const at = (om.assetType ?? "").toUpperCase();
    if (at === "CRYPTO") crypto.add(om.ticker.toUpperCase());
    else if (at === "EQUITY") equity.add(om.ticker.toUpperCase());
  }

  const [cg, tg] = await Promise.all([
    config.underlyingEnabled && crypto.size ? fetchUnderlyingPrices([...crypto]) : Promise.resolve([]),
    config.tiingoApiKey && equity.size ? fetchEquityPrices([...equity]) : Promise.resolve([]),
  ]);
  const rows = [
    ...cg.map((p) => ({ ...p, source: "coingecko" })),
    ...tg.map((p) => ({ ...p, source: "tiingo" })),
  ];
  if (rows.length === 0) return out;

  const ts = new Date();
  for (const p of rows) out.set(p.ticker, p.price);
  await query(
    `INSERT INTO underlying_prices (ticker, ts, price, source)
     VALUES ${placeholders(rows.length, 4)}
     ON CONFLICT (ticker, ts) DO NOTHING`,
    rows.flatMap((p) => [p.ticker, ts, p.price, p.source]),
  );
  return out;
}

/** Poll the trade tape for the given slugs and upsert new fills. */
async function recordTrades(slugs: string[], map: Map<string, FlatMarket>): Promise<number> {
  const rows: unknown[][] = [];
  await mapLimit(slugs, async (slug) => {
    const yesTok = map.get(slug)?.m.tokens?.yes;
    for (const e of await fetchMarketEvents(slug)) {
      rows.push([
        slug, e.txHash ?? null, e.tokenId ?? null,
        e.tokenId && yesTok ? (e.tokenId === yesTok ? "Yes" : "No") : null,
        e.side === 0 ? "buy" : "sell",
        e.price ?? null,
        nn(e.matchedSize) == null ? null : (nn(e.matchedSize) as number) / 1e6,
        nn(e.takerAmount) == null ? null : (nn(e.takerAmount) as number) / 1e6,
        e.profile?.account ?? null,
        new Date(e.createdAt),
      ]);
    }
  }, 3);
  if (rows.length === 0) return 0;
  const cols = ["slug", "tx_hash", "token_id", "outcome", "side", "price", "size", "collateral", "taker", "created_at"];
  let inserted = 0;
  for (const batch of chunk(rows, 300)) {
    const res = await query<{ id: string }>(
      `INSERT INTO trades (${cols.join(",")}) VALUES ${placeholders(batch.length, cols.length)}
       ON CONFLICT (tx_hash, token_id, created_at, price) DO NOTHING RETURNING id`,
      batch.flat(),
    );
    inserted += res.length;
  }
  return inserted;
}

/** One Base gas-price reading per cycle, keyed by the shared cycle ts. */
async function recordGas(ts: Date): Promise<void> {
  if (!config.gasTrackingEnabled) return;
  const gwei = await fetchBaseGasGwei();
  if (gwei == null) return;
  await query(
    `INSERT INTO gas_prices (ts, gas_price_gwei, source) VALUES ($1, $2, $3)
     ON CONFLICT (ts) DO NOTHING`,
    [ts, gwei, "base-rpc"],
  );
}

// --- Snapshot ------------------------------------------------------------

export async function runSnapshot(): Promise<number> {
  // Pick up markets created since the last cycle (recurring 5-min/hourly/daily
  // crypto markets churn faster than the discovery interval) before snapshotting.
  const map = await activeBySlug();
  await upsertActive([...map.values()]);
  const tracked = await trackedMarkets(false);
  if (tracked.length === 0) return 0;
  const ts = new Date();

  const present = tracked.filter((t) => map.has(t.slug));
  const missing = tracked.filter((t) => !map.has(t.slug)).map((t) => t.slug);

  // Order book + trade tape only for the soonest-to-expire markets.
  const obTargets = [...present]
    .sort((a, b) => (a.expiration?.getTime() ?? Infinity) - (b.expiration?.getTime() ?? Infinity))
    .slice(0, config.orderbookLimit)
    .map((t) => t.slug);
  const books = new Map<string, ReturnType<typeof bookMetrics>>();
  await mapLimit(obTargets, async (slug) => {
    books.set(slug, bookMetrics(await fetchOrderBook(slug)));
  }, 3);

  const underlying = await fetchUnderlyingMap(present, map);
  await recordTrades(obTargets, map);
  await recordGas(ts);

  const rows = present.map((t) => {
    const fm = map.get(t.slug)!;
    const prices = fm.m.prices ?? [];
    const bm = books.get(t.slug) ?? bookMetrics(null);
    const tp = fm.m.tradePrices;
    const ticker = fm.m.priceOracleMetadata?.ticker?.toUpperCase();
    const vol = fm.m.volumeFormatted ?? fm.m.volume ?? null;
    const mins = t.expiration ? Math.round((t.expiration.getTime() - ts.getTime()) / 60000) : null;
    return [
      t.slug, ts,
      prices[0] ?? null, prices[1] ?? null,
      bm.midpoint, bm.best_bid, bm.best_ask, bm.spread, bm.last_trade_price,
      vol == null ? null : Number(vol),
      bm.book_depth, mins,
      bm.book_bids, bm.book_asks, bm.depth_1c, bm.depth_2c, bm.depth_5c, bm.slippage,
      tp?.buy?.market?.[0] ?? null, tp?.sell?.market?.[0] ?? null,
      ticker ? underlying.get(ticker) ?? null : null,
    ];
  });

  const cols = [
    "slug", "ts", "price_yes", "price_no", "midpoint", "best_bid", "best_ask",
    "spread", "last_trade_price", "volume", "book_depth", "minutes_to_expiration",
    "book_bids", "book_asks", "depth_1c", "depth_2c", "depth_5c", "slippage",
    "buy_yes_price", "sell_yes_price", "underlying_price",
  ];
  for (const batch of chunk(rows, 300)) {
    await query(`INSERT INTO snapshots (${cols.join(",")}) VALUES ${placeholders(batch.length, cols.length)}`, batch.flat());
  }

  // Markets in the list that already carry a winning index.
  const flaggedResolved = present
    .filter((t) => map.get(t.slug)!.m.winningOutcomeIndex != null)
    .map((t) => ({ slug: t.slug, idx: map.get(t.slug)!.m.winningOutcomeIndex as number, status: map.get(t.slug)!.m.status ?? null }));
  if (flaggedResolved.length) await writeResolutions(flaggedResolved);
  const resolvedMissing = await resolveMissing(missing, 300);

  logger.info("snapshots written", {
    markets: rows.length,
    orderBooks: obTargets.length,
    underlying: underlying.size,
    resolved: flaggedResolved.length + resolvedMissing,
    stillMissing: Math.max(0, missing.length - 300),
  });
  return rows.length;
}

// --- Resolution (backstop) -------------------------------------------

export async function runResolution(): Promise<number> {
  const [due, map] = await Promise.all([trackedMarkets(true), activeBySlug()]);
  const missing = due.filter((t) => !map.has(t.slug)).map((t) => t.slug);
  if (missing.length === 0) return 0;
  const n = await resolveMissing(missing, 500);
  logger.info("markets resolved", { count: n, checked: Math.min(missing.length, 500) });
  return n;
}

// --- Retention / downsampling (gap 4) -------------------------------

const RETENTION_BATCH = 20_000;

/**
 * Thin the snapshot history for long-resolved markets. Never touches pending or
 * recently-resolved markets, so the calibration window stays at full resolution.
 */
export async function runRetention(): Promise<number> {
  const full = config.retentionFullDays;
  const coarse = config.retentionCoarseMinutes;
  const drop = config.retentionDropDays;
  let hardDeleted = 0;
  let decimated = 0;

  // 1. optional hard delete of very old resolved markets
  if (drop > 0) {
    for (let i = 0; i < 100_000; i++) {
      const res = await query<{ id: string }>(
        `DELETE FROM snapshots WHERE id = ANY (ARRAY(
           SELECT s.id FROM snapshots s
           WHERE EXISTS (SELECT 1 FROM resolutions r
                         WHERE r.slug = s.slug AND r.resolved_at < now() - make_interval(days => $1))
           LIMIT ${RETENTION_BATCH}
         )) RETURNING id`,
        [drop],
      );
      hardDeleted += res.length;
      if (res.length < RETENTION_BATCH) break;
    }
  }

  // 2. decimate: for markets resolved > `full` days ago, keep only the latest
  //    collection cycle in each `coarse`-minute bucket.
  for (let i = 0; i < 100_000; i++) {
    const res = await query<{ id: string }>(
      `WITH keep AS (
         SELECT date_bin(make_interval(mins => $2), ts, TIMESTAMPTZ 'epoch') AS bucket, max(ts) AS keep_ts
         FROM snapshots
         WHERE ts < now() - make_interval(days => $1)
         GROUP BY 1
       )
       DELETE FROM snapshots WHERE id = ANY (ARRAY(
         SELECT s.id
         FROM snapshots s
         JOIN keep k ON k.bucket = date_bin(make_interval(mins => $2), s.ts, TIMESTAMPTZ 'epoch')
         WHERE s.ts < now() - make_interval(days => $1)
           AND s.ts <> k.keep_ts
           AND EXISTS (SELECT 1 FROM resolutions r
                       WHERE r.slug = s.slug AND r.resolved_at < now() - make_interval(days => $1))
         LIMIT ${RETENTION_BATCH}
       )) RETURNING id`,
      [full, coarse],
    );
    decimated += res.length;
    if (res.length < RETENTION_BATCH) break;
  }

  logger.info("retention sweep", {
    decimated, hardDeleted, fullDays: full, coarseMinutes: coarse, dropDays: drop,
  });
  return decimated + hardDeleted;
}
