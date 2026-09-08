// Underlying crypto spot, one batched request per cycle. No key.
// Limitless equity markets (AAPL, NVDA, SPY, …) have no free real-time feed —
// their oracle_ticker / oracle_asset_type are still stored so a paid stock feed
// can be added later.

import { getJson } from "./http";

// Limitless oracle ticker -> CoinGecko id. Extend as new coins show up.
const CG_ID: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", BNB: "binancecoin",
  DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche-2", LINK: "chainlink", DOT: "polkadot",
  MATIC: "matic-network", POL: "polygon-ecosystem-token", LTC: "litecoin", TRX: "tron",
  SHIB: "shiba-inu", PEPE: "pepe", SUI: "sui", APT: "aptos", ARB: "arbitrum", OP: "optimism",
  NEAR: "near", TON: "the-open-network", HYPE: "hyperliquid", WIF: "dogwifcoin", BONK: "bonk",
  UNI: "uniswap", AAVE: "aave", ATOM: "cosmos", FIL: "filecoin", INJ: "injective-protocol",
};

/** @param tickers Limitless oracle tickers (CRYPTO asset type). */
export async function fetchUnderlyingPrices(
  tickers: string[],
): Promise<{ ticker: string; price: number }[]> {
  const pairs = tickers
    .map((t) => t.toUpperCase())
    .filter((t, i, a) => a.indexOf(t) === i)
    .map((t) => [t, CG_ID[t]] as const)
    .filter((p): p is [string, string] => !!p[1]);
  if (pairs.length === 0) return [];

  const ids = [...new Set(pairs.map(([, id]) => id))].join(",");
  try {
    const r = await getJson<Record<string, { usd?: number }>>(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    );
    const out: { ticker: string; price: number }[] = [];
    for (const [ticker, id] of pairs) {
      const p = r[id]?.usd;
      if (typeof p === "number") out.push({ ticker, price: p });
    }
    return out;
  } catch {
    return [];
  }
}
