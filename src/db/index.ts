import { Pool } from "pg";
import { config } from "../config";

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query(text, params as unknown[]);
  return res.rows as T[];
}
