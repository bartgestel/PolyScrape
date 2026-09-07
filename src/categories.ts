// Category configs consumed by the generic collector. Discovery differs per
// category (different Gamma queries + metadata extraction); polling and
// resolution are fully generic and live in collector.ts.

import { fetchEvents, fetchLeagues, GammaMarket, jsonArray } from "./gamma";
import { mapLimit } from "./http";
import { logger } from "./logger";
import {
  isFahrenheit, parseThreshold, parseWeatherLocation, parseWeatherMetric,
} from "./parse";
import { fetchFinalScore } from "./scores/espn";
import { fetchMeasuredValue } from "./scores/weather";

export interface NormalizedMarket {
  market_id: string;
  question: string;
  resolves_at: string | null;
  extra: Record<string, unknown>;
}

export type TrackedMarket = {
  market_id: string;
  question: string;
  resolves_at: Date | null;
} & Record<string, unknown>;

export interface Category {
  name: "sports" | "weather";
  marketsTable: string;
  snapshotsTable: string;
  resolutionsTable: string;
  marketExtraColumns: string[];
  snapshotExtraColumns: string[];
  resolutionExtraColumns: string[];
  discover(): Promise<NormalizedMarket[]>;
  /** price_yes / price_no for this market. Weather markets are Yes/No; sports
   *  moneylines are team-vs-team, so price_yes = P(home_team). */
  mapPrices(m: TrackedMarket, gm: GammaMarket): { yes: number | null; no: number | null };
  snapshotExtra(m: TrackedMarket, gm: GammaMarket): Record<string, unknown>;
  backfillResolution(m: TrackedMarket, outcome: string): Promise<Record<string, unknown>>;
}

function priceOf(gm: GammaMarket, outcomeName: string | null, fallbackIndex: number): number | null {
  const outcomes = jsonArray(gm.outcomes);
  const prices = jsonArray(gm.outcomePrices).map(Number);
  const want = outcomeName?.toLowerCase();
  let i = want ? outcomes.findIndex((o) => o.toLowerCase() === want) : -1;
  if (i < 0) i = fallbackIndex;
  return Number.isFinite(prices[i]) ? prices[i] : null;
}

const WEATHER_TAG_ID = 84;

// ponytail: fixed window. Widen if you want longer pre-game price history.
const GAME_WINDOW_PAST_MS = 2 * 24 * 3600 * 1000;
const GAME_WINDOW_FUTURE_MS = 21 * 24 * 3600 * 1000;
function withinGameWindow(gameStartTime: string): boolean {
  const t = new Date(gameStartTime).getTime();
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now - GAME_WINDOW_PAST_MS && t < now + GAME_WINDOW_FUTURE_MS;
}

function dedupe(markets: NormalizedMarket[]): NormalizedMarket[] {
  const seen = new Map<string, NormalizedMarket>();
  for (const m of markets) if (!seen.has(m.market_id)) seen.set(m.market_id, m);
  return [...seen.values()];
}

export const sports: Category = {
  name: "sports",
  marketsTable: "sports_markets",
  snapshotsTable: "sports_snapshots",
  resolutionsTable: "sports_resolutions",
  marketExtraColumns: ["sport", "home_team", "away_team", "game_start_time"],
  snapshotExtraColumns: ["minutes_to_game_start"],
  resolutionExtraColumns: ["final_score"],

  async discover() {
    const leagues = await fetchLeagues();
    const perLeague = await mapLimit(
      leagues,
      async (lg) => {
        try {
          const events = await fetchEvents({ tag_id: lg.primaryTagId, closed: false });
          const rows: NormalizedMarket[] = [];
          for (const ev of events) {
            for (const mk of ev.markets ?? []) {
              if (!mk.conditionId || mk.closed) continue;
              // Games only, near tip-off, and ONLY the full-game moneyline — one
              // market per game (question == event title). Polymarket lists
              // ~150 prop markets per game (spreads, totals, quarters, player
              // props); those are deliberately skipped.
              if (!mk.gameStartTime || !withinGameWindow(mk.gameStartTime)) continue;
              if (mk.question.trim() !== ev.title.trim()) continue;
              const outs = jsonArray(mk.outcomes);
              if (outs.length !== 2) continue; // skip 3-way (draw) markets
              // Polymarket lists outcomes in title order; `ordering` says whether
              // the title leads with the home or away side.
              const homeFirst = lg.ordering === "home";
              rows.push({
                market_id: mk.conditionId,
                question: mk.question,
                resolves_at: mk.endDate ?? ev.endDate ?? null,
                extra: {
                  sport: lg.sport,
                  home_team: homeFirst ? outs[0] : outs[1],
                  away_team: homeFirst ? outs[1] : outs[0],
                  game_start_time: mk.gameStartTime,
                },
              });
            }
          }
          return rows;
        } catch (err) {
          logger.warn("sports league discovery failed", { league: lg.sport, err });
          return [];
        }
      },
      4,
    );
    return dedupe(perLeague.flat());
  },

  mapPrices(m, gm) {
    return {
      yes: priceOf(gm, (m.home_team as string) ?? null, 1),
      no: priceOf(gm, (m.away_team as string) ?? null, 0),
    };
  },

  snapshotExtra(m) {
    const start = m.game_start_time ? new Date(m.game_start_time as string) : null;
    return {
      minutes_to_game_start: start ? Math.round((start.getTime() - Date.now()) / 60000) : null,
    };
  },

  async backfillResolution(m) {
    const start = m.game_start_time ? new Date(m.game_start_time as string) : null;
    const final_score = await fetchFinalScore(
      (m.sport as string) ?? null,
      start,
      (m.home_team as string) ?? null,
      (m.away_team as string) ?? null,
    );
    return { final_score };
  },
};

export const weather: Category = {
  name: "weather",
  marketsTable: "weather_markets",
  snapshotsTable: "weather_snapshots",
  resolutionsTable: "weather_resolutions",
  marketExtraColumns: [
    "location", "metric", "threshold", "measurement_window_start", "measurement_window_end",
  ],
  snapshotExtraColumns: [],
  resolutionExtraColumns: ["actual_measured_value"],

  async discover() {
    const events = await fetchEvents({ tag_id: WEATHER_TAG_ID, closed: false });
    const rows: NormalizedMarket[] = [];
    for (const ev of events) {
      const tagSlugs = (ev.tags ?? []).map((t) => t.slug);
      for (const mk of ev.markets ?? []) {
        if (!mk.conditionId || mk.closed) continue;
        rows.push({
          market_id: mk.conditionId,
          question: mk.question,
          resolves_at: mk.endDate ?? ev.endDate ?? null,
          extra: {
            location: parseWeatherLocation(tagSlugs, mk.question),
            metric: parseWeatherMetric(tagSlugs, mk.question),
            threshold: parseThreshold(mk.question),
            measurement_window_start: ev.startDate ?? null,
            measurement_window_end: mk.endDate ?? ev.endDate ?? null,
          },
        });
      }
    }
    return dedupe(rows);
  },

  mapPrices(_m, gm) {
    return { yes: priceOf(gm, "Yes", 0), no: priceOf(gm, "No", 1) };
  },

  snapshotExtra() {
    return {};
  },

  async backfillResolution(m) {
    const day =
      (m.measurement_window_end as string | null)
        ? new Date(m.measurement_window_end as string)
        : m.resolves_at;
    const actual_measured_value = await fetchMeasuredValue(
      (m.location as string) ?? null,
      (m.metric as string) ?? null,
      day,
      isFahrenheit(m.question),
    );
    return { actual_measured_value };
  },
};

export const CATEGORIES: Category[] = [sports, weather];

/** Token id to sample the order book for (Yes side for weather, first outcome otherwise). */
export function bookTokenId(gm: GammaMarket): string {
  const outcomes = jsonArray(gm.outcomes);
  const tokens = jsonArray(gm.clobTokenIds);
  const yi = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  return tokens[yi >= 0 ? yi : 0] ?? "";
}
