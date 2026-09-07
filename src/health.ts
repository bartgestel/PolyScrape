// Tiny HTTP health endpoint. Healthy = a snapshot cycle completed recently.

import { createServer } from "http";
import { config } from "./config";
import { logger } from "./logger";

let lastSnapshotOk = 0;

export function markSnapshotOk(): void {
  lastSnapshotOk = Date.now();
}

export function startHealthServer(): void {
  const staleMs = config.snapshotIntervalMinutes * 60_000 * 3; // miss ~3 cycles => unhealthy

  const server = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    const age = lastSnapshotOk === 0 ? null : Date.now() - lastSnapshotOk;
    const healthy = age !== null && age < staleMs;
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ healthy, lastSnapshotAgeMs: age, staleThresholdMs: staleMs }));
  });

  server.listen(config.healthPort, () => logger.info("health server up", { port: config.healthPort }));
}
