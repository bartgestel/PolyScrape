// Base L2 gas price via eth_gasPrice JSON-RPC. One best-effort call per snapshot
// cycle — kept off the Limitless rate gate (different host, not rate-limited).

import { config } from "./config";

export async function fetchBaseGasGwei(): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(config.baseRpcUrl, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: string };
    if (!j.result) return null;
    const wei = Number(BigInt(j.result)); // Base gas is sub-gwei; well within Number range
    return Number.isFinite(wei) ? wei / 1e9 : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
