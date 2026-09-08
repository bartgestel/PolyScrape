// Limitless Exchange read-only API client. No auth needed for public market data.
// https://api.limitless.exchange   docs: https://docs.limitless.exchange

import { config } from "./config";
import { getJson } from "./http";

const api = (path: string) => `${config.limitlessApiHost}${path}`;

export interface LimitlessToken {
  yes?: string;
  no?: string;
}

// Shape is a superset across single markets and flattened group children.
export interface LimitlessMarket {
  id?: number;
  slug: string;
  stableSlug?: string | null;
  title: string;
  conditionId?: string;
  categories?: string[];
  marketType?: string; // "single" | "group"
  tradeType?: string; // "clob" | "amm"
  status?: string;
  expired?: boolean;
  createdAt?: string;
  startAt?: string;
  expirationTimestamp?: number | string;
  expirationDate?: string;
  tokens?: LimitlessToken;
  prices?: number[]; // [yes, no]
  volume?: string | number;
  volumeFormatted?: string;
  winningOutcomeIndex?: number | null;
  // metadata (present in the /markets/active payload)
  description?: string;
  automationType?: string;
  isRewardable?: boolean;
  tags?: string[];
  creator?: { name?: string; username?: string; address?: string };
  priceOracleMetadata?: { ticker?: string; assetType?: string; chartSource?: string };
  properties?: { propertyKeySlug: string; value: string[] }[];
  settings?: {
    minSize?: string | number;
    maxSpread?: string | number;
    dailyReward?: string | number;
    rebateRate?: string | number;
    creatorFeePct?: string | number;
  };
  tradePrices?: {
    buy?: { market?: number[]; limit?: number[] };
    sell?: { market?: number[]; limit?: number[] };
  };
  // group only:
  markets?: LimitlessMarket[];
}

export interface MarketEvent {
  createdAt: string;
  side: number; // 0 = BUY, 1 = SELL (taker)
  price: number;
  matchedSize: string; // raw 6-dec position tokens
  takerAmount: string; // raw 6-dec collateral (USDC)
  tokenId?: string;
  txHash?: string;
  profile?: { account?: string };
}

export interface ActivePage {
  data: LimitlessMarket[];
  totalMarketsCount: number;
}

export interface OrderBook {
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  midpoint?: number;
  adjustedMidpoint?: number;
  maxSpread?: string | number;
  lastTradePrice?: number | null;
}

const PAGE_SIZE = 25;

/** All active (unresolved) markets, paginating /markets/active. */
export async function fetchActiveMarkets(): Promise<LimitlessMarket[]> {
  const out: LimitlessMarket[] = [];
  for (let page = 1; ; page++) {
    const res = await getJson<ActivePage>(api(`/markets/active?page=${page}`));
    out.push(...res.data);
    if (res.data.length < PAGE_SIZE) break;
    if (out.length >= (res.totalMarketsCount || 0) && res.totalMarketsCount) break;
    if (page > 400) break; // safety
  }
  return out;
}

export async function fetchMarket(slug: string): Promise<LimitlessMarket | null> {
  try {
    return await getJson<LimitlessMarket>(api(`/markets/${encodeURIComponent(slug)}`));
  } catch {
    return null; // 404 once a market is delisted
  }
}

export async function fetchOrderBook(slug: string): Promise<OrderBook | null> {
  try {
    return await getJson<OrderBook>(api(`/markets/${encodeURIComponent(slug)}/orderbook`));
  } catch {
    return null;
  }
}

/** Most recent public MINED CLOB trades for a market (newest first). */
export async function fetchMarketEvents(slug: string): Promise<MarketEvent[]> {
  try {
    const r = await getJson<{ events?: MarketEvent[] }>(
      api(`/markets/${encodeURIComponent(slug)}/events?page=1&limit=100`),
    );
    return r.events ?? [];
  } catch {
    return [];
  }
}

/** "...captured ... was $79,713.44" → 79713.44 */
export function parseStrike(description: string | undefined): number | null {
  if (!description) return null;
  const m = description.match(/(?:captured|price to beat)[^$]{0,120}\$([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** frequency from tags/properties: daily | hourly | weekly | ... */
export function marketFrequency(m: LimitlessMarket): string | null {
  const dur = m.properties?.find((p) => p.propertyKeySlug === "duration")?.value?.[0];
  if (dur) return dur;
  const tag = (m.tags ?? []).map((t) => t.toLowerCase()).find((t) =>
    ["daily", "hourly", "weekly", "monthly", "minutely"].includes(t),
  );
  return tag ?? null;
}

export function expirationMs(m: LimitlessMarket): number | null {
  const v = m.expirationTimestamp;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export interface FlatMarket {
  m: LimitlessMarket;
  groupSlug: string | null;
  /** Composed display title ("<group> — <child>" for group children). */
  title: string;
}

/** Flatten a discovery page: single markets pass through; groups yield their children. */
export function flattenMarkets(items: LimitlessMarket[]): FlatMarket[] {
  const out: FlatMarket[] = [];
  for (const it of items) {
    if (it.marketType === "group" && Array.isArray(it.markets)) {
      for (const child of it.markets) {
        if (!child.slug) continue;
        out.push({
          m: { ...child, categories: child.categories ?? it.categories, tradeType: child.tradeType ?? it.tradeType },
          groupSlug: it.slug,
          title: `${it.title} — ${child.title}`,
        });
      }
    } else if (it.slug) {
      out.push({ m: it, groupSlug: null, title: it.title });
    }
  }
  return out;
}
