import { Pool } from "pg";

// Lazily created so `next build` (which loads route modules to collect config)
// doesn't need DATABASE_URL — only an actual request does.
const g = globalThis as unknown as { _pgPool?: Pool };

function getPool(): Pool {
  if (g._pgPool) return g._pgPool;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    // Pin read-only so a stray write query fails instead of touching collector data.
    options: "-c default_transaction_read_only=on",
  });
  g._pgPool = pool;
  return pool;
}

export async function q<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await getPool().query(text, params as unknown[]);
  return res.rows as T[];
}
