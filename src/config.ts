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
  clobHost: process.env.POLYMARKET_CLOB_HOST || "https://clob.polymarket.com",
  gammaHost: process.env.POLYMARKET_GAMMA_HOST || "https://gamma-api.polymarket.com",
  snapshotIntervalMinutes: num("SNAPSHOT_INTERVAL_MINUTES", 2),
  discoveryIntervalHours: num("DISCOVERY_INTERVAL_HOURS", 3),
  resolutionCheckIntervalMinutes: num("RESOLUTION_CHECK_INTERVAL_MINUTES", 20),
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  healthPort: num("HEALTH_PORT", 8080),
  // ponytail: fixed concurrency cap for outbound API calls. Bump if the snapshot
  // cycle can't finish inside SNAPSHOT_INTERVAL_MINUTES at your market count.
  httpConcurrency: num("HTTP_CONCURRENCY", 8),
};
