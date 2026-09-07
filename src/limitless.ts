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
  // group only:
  markets?: LimitlessMarket[];
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
