// Central env config. Fails fast if DATABASE_URL is missing.

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
}

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return v.toLowerCase() !== "false" && v !== "0";
}

function numList(name: string, def: number[]): number[] {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const out = v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return out.length ? out : def;
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
  // Per snapshot cycle, fetch the order book + trade tape for at most this many
  // markets, soonest-to-expire first. Price/volume come from the bulk list for
  // every market regardless. 0 disables order-book / trade polling.
  orderbookLimit: num("ORDERBOOK_LIMIT", 100),
  // Collect underlying crypto spot (CoinGecko, one batched request per cycle).
  underlyingEnabled: bool("UNDERLYING_ENABLED", true),
  // Equity underlying (Tiingo IEX, one batched request per cycle). Needs a key;
  // a quote is only stored if its trade timestamp is fresher than EQUITY_STALE_MINUTES,
  // so nothing is written while US markets are closed.
  tiingoApiKey: process.env.TIINGO_API_KEY || "",
  equityStaleMinutes: num("EQUITY_STALE_MINUTES", 20),

  // --- slippage (gap 2) ---
  // Representative market-order sizes (USDC) for the per-snapshot slippage estimate.
  slippageOrderSizesUsdc: numList("SLIPPAGE_ORDER_SIZES_USDC", [50, 250, 1000]),

  // --- gas tracking (gap 3) ---
  gasTrackingEnabled: bool("GAS_TRACKING_ENABLED", true),
  baseRpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",

  // --- retention / downsampling (gap 4) ---
  retentionIntervalHours: num("RETENTION_INTERVAL_HOURS", 24),
  // Keep full 2-min resolution until a market has been resolved this long.
  retentionFullDays: num("RETENTION_FULL_DAYS", 7),
  // After that, thin to one collection cycle per this many minutes.
  retentionCoarseMinutes: num("RETENTION_COARSE_MINUTES", 15),
  // > 0: additionally hard-delete all snapshots for markets resolved longer ago
  // than this. 0 disables the hard delete.
  retentionDropDays: num("RETENTION_DROP_DAYS", 0),

  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  healthPort: num("HEALTH_PORT", 8080),
  httpConcurrency: num("HTTP_CONCURRENCY", 4),
  // Process-wide cap on outbound requests/sec to the Limitless API (Cloudflare
  // 429s bursts). Keep low.
  limitlessRps: num("LIMITLESS_RPS", 6),
};
