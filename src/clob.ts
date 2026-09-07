// Polymarket CLOB REST client. Read-only, no auth needed for book/price data.
// https://clob.polymarket.com

import { config } from "./config";
import { getJson } from "./http";

interface BookLevel {
  price: string;
  size: string;
}
interface Book {
  bids: BookLevel[];
  asks: BookLevel[];
}

/**
 * Total resting size (shares) across both sides of the book for a token.
 * Simple, unweighted depth — enough as a liquidity signal for backtesting.
 */
export async function bookDepth(tokenId: string): Promise<number | null> {
  if (!tokenId) return null;
  try {
    const book = await getJson<Book>(`${config.clobHost}/book?token_id=${tokenId}`);
    const sum = (levels: BookLevel[]) => levels.reduce((a, l) => a + Number(l.size), 0);
    return sum(book.bids ?? []) + sum(book.asks ?? []);
  } catch {
    return null; // market may not have an active book yet
  }
}
