// Minimal structured JSON logger to stdout. No dependency.

import { config } from "./config";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const threshold = Math.max(0, LEVELS.indexOf(config.logLevel as Level));

function log(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (LEVELS.indexOf(level) < threshold) return;
  const line = { ts: new Date().toISOString(), level, msg, ...extra };
  const out = JSON.stringify(line, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v));
  if (level === "error" || level === "warn") process.stderr.write(out + "\n");
  else process.stdout.write(out + "\n");
}

export const logger = {
  debug: (m: string, e?: Record<string, unknown>) => log("debug", m, e),
  info: (m: string, e?: Record<string, unknown>) => log("info", m, e),
  warn: (m: string, e?: Record<string, unknown>) => log("warn", m, e),
  error: (m: string, e?: Record<string, unknown>) => log("error", m, e),
};
