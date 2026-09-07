// Polymarket Gamma API client (market discovery + metadata + resolution status).
// Read-only, no auth. https://gamma-api.polymarket.com

import { config } from "./config";
import { getJson } from "./http";

export interface GammaMarket {
  conditionId: string;
  question: string;
  slug?: string;
  description?: string;
  closed: boolean;
  outcomes: string; // JSON string: ["Yes","No"]
  outcomePrices: string; // JSON string: ["0.55","0.45"]
  clobTokenIds?: string; // JSON string: ["<yes>","<no>"]
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  volume24hr?: number;
  liquidityNum?: number;
  gameStartTime?: string;
  endDate?: string;
  endDateIso?: string;
  closedTime?: string;
  startDate?: string;
  umaResolutionStatuses?: string;
}

export interface GammaEvent {
  id: string;
  title: string;
  slug?: string;
  startDate?: string;
  endDate?: string;
  closed?: boolean;
  tags?: { id: string; slug: string; label?: string }[];
  markets?: GammaMarket[];
}

export interface SportsLeague {
  id: number;
  sport: string;
  name: string;
  primaryTagId: number;
  ordering?: string; // "home" | "away" -> which team the title lists first
}

const g = (path: string) => `${config.gammaHost}${path}`;

export function jsonArray(s: string | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Paginate an events endpoint until a short page comes back. */
export async function fetchEvents(params: Record<string, string | number | boolean>): Promise<GammaEvent[]> {
  const out: GammaEvent[] = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const qs = new URLSearchParams({ ...mapStr(params), limit: String(limit), offset: String(offset) });
    const page = await getJson<GammaEvent[]>(g(`/events?${qs}`));
    out.push(...page);
    if (page.length < limit) break;
    if (offset > 20_000) break; // safety
  }
  return out;
}

export async function fetchLeagues(): Promise<SportsLeague[]> {
  return getJson<SportsLeague[]>(g("/sports"));
}

/** Fetch live market state for a batch of conditionIds. */
export async function fetchMarketsByCondition(conditionIds: string[]): Promise<GammaMarket[]> {
  if (conditionIds.length === 0) return [];
  const qs = new URLSearchParams();
  for (const id of conditionIds) qs.append("condition_ids", id);
  qs.set("limit", String(conditionIds.length));
  return getJson<GammaMarket[]>(g(`/markets?${qs}`));
}

function mapStr(o: Record<string, string | number | boolean>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
}

/** A market is resolved once Gamma closes it and the outcome prices collapse to 0/1. */
export function resolvedOutcome(m: GammaMarket): string | null {
  if (!m.closed) return null;
  const prices = jsonArray(m.outcomePrices).map(Number);
  const outcomes = jsonArray(m.outcomes);
  if (prices.length !== outcomes.length || prices.length === 0) return null;
  const winner = prices.findIndex((p) => p >= 0.99);
  const loser = prices.findIndex((p) => p <= 0.01);
  if (winner === -1 || loser === -1 || winner === loser) return null;
  return outcomes[winner];
}
