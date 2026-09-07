export type Category = "sports" | "weather";

export function isCategory(v: string | null | undefined): v is Category {
  return v === "sports" || v === "weather";
}

export function polymarketUrl(eventSlug: string | null | undefined): string | null {
  return eventSlug ? `https://polymarket.com/event/${eventSlug}` : null;
}

export interface OverviewRow {
  category: Category;
  tracked: number;
  resolved: number;
  pending: number;
}

export interface MarketRow {
  market_id: string;
  question: string;
  event_slug: string | null;
  resolves_at: string | null;
  last_price: number | null;
  last_ts: string | null;
  outcome: string | null;
  resolved_at: string | null;
  // sports
  sport?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  game_start_time?: string | null;
  // weather
  location?: string | null;
  metric?: string | null;
  threshold?: number | null;
}

export interface Snapshot {
  ts: string;
  price_yes: number | null;
  price_no: number | null;
  spread: number | null;
  volume_24h: number | null;
  book_depth: number | null;
  minutes_to_game_start?: number | null;
}

export interface MarketDetail {
  category: Category;
  market: MarketRow;
  snapshots: Snapshot[];
  resolution:
    | {
        resolved_at: string | null;
        outcome: string | null;
        final_score?: string | null;
        actual_measured_value?: number | null;
      }
    | null;
}

export interface CalibrationBin {
  bin_mid: number; // 0.05, 0.15, ... 0.95
  n: number;
  predicted_mean: number;
  actual_freq: number;
}

export interface CalibrationResult {
  category: Category;
  hoursBeforeResolution: number;
  matchToleranceHours: number;
  minBinSize: number;
  resolvedMarkets: number;
  matchedMarkets: number;
  bins: CalibrationBin[];
}
