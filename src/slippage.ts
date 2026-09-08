// Market-order slippage estimate from stored order-book levels. Pure.

export type Level = { price: number; size: number }; // size in outcome tokens (shares)

/** Volume-weighted fill price for a market order of `usdc` USDC walking `levels`. */
export function vwapFill(levels: Level[], usdc: number): number | null {
  let spent = 0;
  let tokens = 0;
  for (const l of levels) {
    if (spent >= usdc) break;
    const levelUsdc = l.price * l.size;
    const take = Math.min(usdc - spent, levelUsdc);
    spent += take;
    tokens += take / l.price;
  }
  return tokens > 0 ? spent / tokens : null;
}

/**
 * Buy/sell slippage vs midpoint for each order size.
 * @param bids best (highest price) first
 * @param asks best (lowest price) first
 * @returns { buy: {"<size>": vwapBuy - mid}, sell: {"<size>": mid - vwapSell} }, or null
 */
export function computeSlippage(
  bids: Level[],
  asks: Level[],
  mid: number | null,
  sizesUsdc: number[],
): { buy: Record<string, number>; sell: Record<string, number> } | null {
  if (mid == null || (bids.length === 0 && asks.length === 0)) return null;
  const buy: Record<string, number> = {};
  const sell: Record<string, number> = {};
  for (const size of sizesUsdc) {
    const vb = vwapFill(asks, size);
    const vs = vwapFill(bids, size);
    if (vb != null) buy[String(size)] = Number((vb - mid).toFixed(6));
    if (vs != null) sell[String(size)] = Number((mid - vs).toFixed(6));
  }
  if (Object.keys(buy).length === 0 && Object.keys(sell).length === 0) return null;
  return { buy, sell };
}
