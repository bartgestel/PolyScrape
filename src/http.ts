// Tiny fetch helper: JSON GET with timeout, retry, and 429 backoff.
// Plus a hand-rolled concurrency limiter so we don't need p-limit.

import { config } from "./config";
import { logger } from "./logger";

export async function getJson<T = unknown>(url: string, attempt = 1): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    // A real UA is required — Polymarket's Cloudflare 403s the default Node/undici UA.
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
    if (retryable && attempt < 4) {
      const wait = 500 * 2 ** (attempt - 1);
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
