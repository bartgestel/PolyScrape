// Entrypoint: run migrations, then three interval loops (discovery, snapshot,
// resolution) over every category. setInterval, no job queue.

import { CATEGORIES } from "./categories";
import { runDiscovery, runResolution, runSnapshot } from "./collector";
import { config } from "./config";
import { pool } from "./db";
import { runMigrations } from "./db/migrate";
import { markSnapshotOk, startHealthServer } from "./health";
import { logger } from "./logger";

const MIN = 60_000;

/** Run an async job now and then every `everyMs`, never overlapping, never throwing out. */
function schedule(name: string, everyMs: number, job: () => Promise<void>, runNow = true): void {
  let running = false;
  const tick = async () => {
    if (running) {
      logger.warn("skipping tick, previous run still going", { job: name });
      return;
    }
    running = true;
    const t0 = Date.now();
    try {
      await job();
      logger.info("job done", { job: name, ms: Date.now() - t0 });
    } catch (err) {
      logger.error("job failed", { job: name, err });
    } finally {
      running = false;
    }
  };
  if (runNow) void tick();
  setInterval(tick, everyMs);
}

async function main() {
  await runMigrations();
  startHealthServer();

  // Seed the market tables once before the polling loops start.
  for (const cat of CATEGORIES) {
    try {
      await runDiscovery(cat);
    } catch (err) {
      logger.error("initial discovery failed", { category: cat.name, err });
    }
  }

  schedule(
    "discovery",
    config.discoveryIntervalHours * 60 * MIN,
    async () => {
      for (const cat of CATEGORIES) await runDiscovery(cat);
    },
    false, // already seeded above
  );

  schedule("snapshot", config.snapshotIntervalMinutes * MIN, async () => {
    let total = 0;
    for (const cat of CATEGORIES) total += await runSnapshot(cat);
    markSnapshotOk();
    logger.info("snapshot cycle complete", { total });
  });

  schedule("resolution", config.resolutionCheckIntervalMinutes * MIN, async () => {
    for (const cat of CATEGORIES) await runResolution(cat);
  });
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info("shutting down", { sig });
    pool.end().finally(() => process.exit(0));
  });
}

main().catch((err) => {
  logger.error("fatal", { err });
  process.exit(1);
});
