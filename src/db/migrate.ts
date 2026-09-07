// Numbered-SQL migration runner. Applies every migrations/*.sql not yet recorded
// in schema_migrations, each in its own transaction, in filename order.
// ponytail: forward-only, no down migrations. This collector's schema is stable
// for the data-collection month; add a real tool (node-pg-migrate) if that changes.

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pool } from "./index";
import { logger } from "../logger";

const MIGRATIONS_DIR = join(__dirname, "../../migrations");

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const applied = new Set(
      (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name as string),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      logger.info("applying migration", { file });
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
    logger.info("migrations up to date", { count: files.length });
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      logger.error("migration run failed", { err });
      process.exit(1);
    });
}
