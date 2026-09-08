// Equity underlying spot via Tiingo's IEX endpoint. One batched request per cycle.
// Mirrors coingecko.ts. A quote is returned only if its trade timestamp is fresher
// than EQUITY_STALE_MINUTES, so nothing is stored while US markets are closed
// (nights / weekends / holidays) — no market calendar needed.

import { config } from "./config";
import { getJson } from "./http";

interface IexQuote {
  ticker: string;
  last?: number | null;
  tngoLast?: number | null;
  lastSaleTimestamp?: string;
  timestamp?: string;
  quoteTimestamp?: string;
}

/** @param tickers Limitless oracle tickers (EQUITY asset type). */
export async function fetchEquityPrices(
  tickers: string[],
): Promise<{ ticker: string; price: number }[]> {
  if (!config.tiingoApiKey || tickers.length === 0) return [];
  const uniq = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const maxAgeMs = config.equityStaleMinutes * 60_000;
  const now = Date.now();

  try {
    const rows = await getJson<IexQuote[]>(
      `https://api.tiingo.com/iex/?tickers=${uniq.join(",")}&token=${encodeURIComponent(config.tiingoApiKey)}`,
    );
    const out: { ticker: string; price: number }[] = [];
    for (const r of rows ?? []) {
      const price = r.last ?? r.tngoLast;
      const stamp = r.lastSaleTimestamp ?? r.timestamp ?? r.quoteTimestamp;
      const ageMs = stamp ? now - Date.parse(stamp) : NaN;
      if (typeof price === "number" && Number.isFinite(price) && Number.isFinite(ageMs) && ageMs <= maxAgeMs) {
        out.push({ ticker: r.ticker.toUpperCase(), price });
      }
    }
    return out;
  } catch {
    return [];
  }
}
