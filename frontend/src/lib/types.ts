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

export interface BookLevel {
  price: number;
  size: number;
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
  depth_1c: number | null;
  depth_2c: number | null;
  depth_5c: number | null;
  buy_yes_price: number | null;
  sell_yes_price: number | null;
  underlying_price: number | null;
  book_bids: BookLevel[] | null;
  book_asks: BookLevel[] | null;
}

export interface Trade {
  created_at: string;
  outcome: string | null;
  side: string | null;
  price: number | null;
  size: number | null;
  collateral: number | null;
  taker: string | null;
}

export interface MarketDetail {
  market: MarketRow & {
    condition_id: string | null;
    trade_type: string | null;
    group_slug: string | null;
    source_created_at: string | null;
    description: string | null;
    creator_name: string | null;
    automation_type: string | null;
    frequency: string | null;
    is_rewardable: boolean | null;
    oracle_ticker: string | null;
    oracle_asset_type: string | null;
    oracle_source: string | null;
    strike_price: number | null;
    max_spread: number | null;
    daily_reward: number | null;
    rebate_rate: number | null;
    creator_fee_pct: number | null;
    min_size: number | null;
  };
  snapshots: Snapshot[];
  trades: Trade[];
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
