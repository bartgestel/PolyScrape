// Tiny fetch helper: JSON GET with timeout, retry, and 429 backoff.
// Plus a hand-rolled concurrency limiter so we don't need p-limit.

import { config } from "./config";
import { logger } from "./logger";

// Global outbound rate limiter — Limitless sits behind Cloudflare and returns
// HTTP 429 (error 1015) under bursty load. Every request start is spaced by
// at least 1000/LIMITLESS_RPS ms, process-wide.
let nextSlot = 0;
async function rateGate(): Promise<void> {
  const gap = 1000 / Math.max(1, config.limitlessRps);
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + gap;
  if (wait > 0) await sleep(wait);
}

export async function getJson<T = unknown>(url: string, attempt = 1): Promise<T> {
  await rateGate();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    // Some CDNs 403 the default Node/undici UA; send a real one.
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "polyscrape/0.1 (+market-data collector)" },
    });
    if (res.status === 429 || res.status >= 500) {
      throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { retryable: true });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } catch (err) {
    const retryable = (err as { retryable?: boolean }).retryable || (err as Error).name === "AbortError";
    if (retryable && attempt < 5) {
      const wait = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s, 8s
      logger.debug("http retry", { url, attempt, wait });
      await sleep(wait);
      return getJson<T>(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ponytail: naive fixed-size worker pool, good enough for a few thousand tasks/cycle.
export async function mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>, limit = config.httpConcurrency): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
