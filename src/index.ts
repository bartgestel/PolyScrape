// Entrypoint: run migrations, then three interval loops (discovery, snapshot,
// resolution) against Limitless Exchange. setInterval, no job queue.

import { runDiscovery, runResolution, runRetention, runSnapshot } from "./collector";
import { config } from "./config";
import { pool } from "./db";
import { runMigrations } from "./db/migrate";
import { markSnapshotOk, startHealthServer } from "./health";
import { logger } from "./logger";

const MIN = 60_000;

/** Run an async job now and every `everyMs`, never overlapping, never throwing out. */
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

  try {
    await runDiscovery();
  } catch (err) {
    logger.error("initial discovery failed", { err });
  }

  schedule("discovery", config.discoveryIntervalHours * 60 * MIN, () => runDiscovery().then(() => undefined), false);

  schedule("snapshot", config.snapshotIntervalMinutes * MIN, async () => {
    await runSnapshot();
    markSnapshotOk();
  });

  schedule("resolution", config.resolutionCheckIntervalMinutes * MIN, () => runResolution().then(() => undefined));

  // Retention sweep — does not run on boot (large first pass), only on interval.
  schedule("retention", config.retentionIntervalHours * 60 * MIN, () => runRetention().then(() => undefined), false);
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
