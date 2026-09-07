export function limitlessUrl(slug: string | null | undefined): string | null {
  return slug ? `https://limitless.exchange/markets/${slug}` : null;
}

export interface OverviewSummary {
  totalMarkets: number;
  resolved: number;
  pending: number;
  byCategory: { category: string; tracked: number; resolved: number }[];
}

export interface MarketRow {
  slug: string;
  title: string;
  categories: string[];
  market_type: string | null;
  group_slug: string | null;
  stable_slug: string | null;
  expiration: string | null;
  first_seen: string | null;
  last_price: number | null;
  last_ts: string | null;
  winning_outcome: string | null;
  winning_outcome_index: number | null;
  resolved_at: string | null;
}

export interface Snapshot {
  ts: string;
  price_yes: number | null;
  price_no: number | null;
  midpoint: number | null;
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
  last_trade_price: number | null;
  volume: number | null;
  book_depth: number | null;
  minutes_to_expiration: number | null;
}

export interface MarketDetail {
  market: MarketRow & {
    condition_id: string | null;
    trade_type: string | null;
    group_slug: string | null;
    source_created_at: string | null;
  };
  snapshots: Snapshot[];
  resolution: {
    resolved_at: string | null;
    winning_outcome: string | null;
    winning_outcome_index: number | null;
    status: string | null;
  } | null;
}

export interface CalibrationBin {
  bin_mid: number;
  n: number;
  predicted_mean: number;
  actual_freq: number;
}

export type MarketTypeFilter = "all" | "standalone" | "group";

export interface CalibrationResult {
  category: string | null;
  marketType: MarketTypeFilter;
  hoursBeforeExpiration: number;
  matchToleranceHours: number;
  minBinSize: number;
  resolvedMarkets: number;
  matchedMarkets: number;
  bins: CalibrationBin[];
}
