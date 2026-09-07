// Central env config. Fails fast if DATABASE_URL is missing.

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const config = {
  databaseUrl: process.env.DATABASE_URL,
  limitlessApiHost: process.env.LIMITLESS_API_HOST || "https://api.limitless.exchange",
  snapshotIntervalMinutes: num("SNAPSHOT_INTERVAL_MINUTES", 2),
  discoveryIntervalHours: num("DISCOVERY_INTERVAL_HOURS", 3),
  resolutionCheckIntervalMinutes: num("RESOLUTION_CHECK_INTERVAL_MINUTES", 20),
  // Skip markets expiring within this many minutes of discovery. Limitless has
  // heavy sub-hour crypto churn (5-min / 15-min markets) that never live long
  // enough for useful price history; 0 tracks absolutely everything.
  minMarketMinutes: num("MIN_MARKET_MINUTES", 30),
  // Per snapshot cycle, fetch the order book (spread / depth / midpoint) for at
  // most this many markets, soonest-to-expire first. Price/volume come from the
  // bulk list for every market regardless. 0 disables order-book polling.
  orderbookLimit: num("ORDERBOOK_LIMIT", 100),
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  healthPort: num("HEALTH_PORT", 8080),
  httpConcurrency: num("HTTP_CONCURRENCY", 4),
  // Process-wide cap on outbound requests/sec to the Limitless API (Cloudflare
  // 429s bursts). Keep low.
  limitlessRps: num("LIMITLESS_RPS", 6),
};
