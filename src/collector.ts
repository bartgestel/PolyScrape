// Discovery / snapshot / resolution against Limitless Exchange.
//
// Every category is collected the same way. Price + volume for the whole tracked
// set come from ONE bulk fetch of /markets/active per cycle (~30 requests);
// order-book depth is polled for only the N soonest-to-expire markets. This
// keeps request volume well under Limitless's Cloudflare rate limit.

import { config } from "./config";
import { query } from "./db";
import { chunk, mapLimit } from "./http";
import {
  expirationMs,
  fetchActiveMarkets,
  fetchMarket,
  fetchOrderBook,
  FlatMarket,
  flattenMarkets,
  OrderBook,
} from "./limitless";
import { logger } from "./logger";

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
    .map(({ m, groupSlug, title }) => [
      m.slug, m.id ?? null, m.conditionId ?? null, title, m.categories ?? [],
      groupSlug ? "group-child" : (m.marketType ?? "single"),
      m.tradeType ?? null, groupSlug, m.stableSlug ?? null,
      m.tokens?.yes ?? null, m.tokens?.no ?? null,
      m.createdAt ? new Date(m.createdAt) : null,
      m.startAt ? new Date(m.startAt) : null,
      toTs(expirationMs(m)),
    ]);
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

function bookMetrics(book: OrderBook | null) {
  if (!book) return { best_bid: null, best_ask: null, spread: null, midpoint: null, last_trade_price: null, book_depth: null };
  const bestBid = book.bids?.length ? Math.max(...book.bids.map((b) => b.price)) : null;
  const bestAsk = book.asks?.length ? Math.min(...book.asks.map((a) => a.price)) : null;
  // Sizes are in USDC base units (6 decimals); report depth in whole USDC.
  const sum = (levels: { size: number }[]) => levels.reduce((a, l) => a + Number(l.size), 0) / 1e6;
  const depth = sum(book.bids ?? []) + sum(book.asks ?? []);
  return {
    best_bid: bestBid,
    best_ask: bestAsk,
    spread: bestBid != null && bestAsk != null ? Number((bestAsk - bestBid).toFixed(6)) : null,
    midpoint: book.adjustedMidpoint ?? book.midpoint ?? null,
    last_trade_price: book.lastTradePrice ?? null,
    book_depth: depth || null,
  };
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

  // Order book only for the soonest-to-expire markets.
  const obTargets = [...present]
    .sort((a, b) => (a.expiration?.getTime() ?? Infinity) - (b.expiration?.getTime() ?? Infinity))
    .slice(0, config.orderbookLimit)
    .map((t) => t.slug);
  const books = new Map<string, ReturnType<typeof bookMetrics>>();
  await mapLimit(obTargets, async (slug) => {
    books.set(slug, bookMetrics(await fetchOrderBook(slug)));
  }, 3);

  const rows = present.map((t) => {
    const fm = map.get(t.slug)!;
    const prices = fm.m.prices ?? [];
    const bm = books.get(t.slug) ?? bookMetrics(null);
    const vol = fm.m.volumeFormatted ?? fm.m.volume ?? null;
    const mins = t.expiration ? Math.round((t.expiration.getTime() - ts.getTime()) / 60000) : null;
    return [
      t.slug, ts,
      prices[0] ?? null, prices[1] ?? null,
      bm.midpoint, bm.best_bid, bm.best_ask, bm.spread, bm.last_trade_price,
      vol == null ? null : Number(vol),
      bm.book_depth, mins,
    ];
  });

  const cols = [
    "slug", "ts", "price_yes", "price_no", "midpoint", "best_bid", "best_ask",
    "spread", "last_trade_price", "volume", "book_depth", "minutes_to_expiration",
  ];
  for (const batch of chunk(rows, 400)) {
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
