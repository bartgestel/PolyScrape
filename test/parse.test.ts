import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://stub"; // config.ts requires it; no connection is made

import {
  parseThreshold, parseWeatherLocation, parseWeatherMetric, isFahrenheit,
} from "../src/parse";
import { resolvedOutcome, jsonArray } from "../src/gamma";
import type { GammaMarket } from "../src/gamma";

test("parseThreshold pulls the number next to a unit or comparison", () => {
  assert.equal(parseThreshold("Will the highest temperature in Denver be 71°F or below on September 9?"), 71);
  assert.equal(parseThreshold("Will it rain more than 0.5 inches in Dallas?"), 0.5);
  assert.equal(parseThreshold("Will the low temperature be below -3 on Friday?"), -3);
  assert.equal(parseThreshold("Will the highest temperature in Denver be between 80-81°F?"), 80);
  assert.equal(parseThreshold("Who wins the game?"), null);
});

test("isFahrenheit", () => {
  assert.equal(isFahrenheit("highest temperature 71°F"), true);
  assert.equal(isFahrenheit("lowest temperature 13°C"), false);
});

test("parseWeatherMetric prefers tags then falls back to text", () => {
  assert.equal(parseWeatherMetric(["weather", "highest-temperature"], "x"), "highest-temperature");
  assert.equal(parseWeatherMetric([], "Lowest temperature in Tokyo?"), "lowest-temperature");
  assert.equal(parseWeatherMetric(["weather", "rain"], "x"), "rain");
});

test("parseWeatherLocation skips generic tags, de-slugs the city", () => {
  assert.equal(parseWeatherLocation(["weather", "recurring", "new-york-city"], "Highest temperature in NYC?"), "new york city");
  assert.equal(parseWeatherLocation([], "Highest temperature in Denver on September 9?"), "Denver");
});

const mkt = (o: Partial<GammaMarket>): GammaMarket =>
  ({ conditionId: "0x1", question: "q", closed: false, outcomes: '["Yes","No"]', outcomePrices: '["0.5","0.5"]', ...o }) as GammaMarket;

test("resolvedOutcome only fires on a closed market with collapsed prices", () => {
  assert.equal(resolvedOutcome(mkt({})), null); // open
  assert.equal(resolvedOutcome(mkt({ closed: true })), null); // closed but 0.5/0.5
  assert.equal(resolvedOutcome(mkt({ closed: true, outcomePrices: '["1","0"]' })), "Yes");
  assert.equal(resolvedOutcome(mkt({ closed: true, outcomePrices: '["0","1"]' })), "No");
});

import { sports, weather } from "../src/categories";
import type { TrackedMarket } from "../src/categories";

test("weather.mapPrices reads the Yes/No outcomes", () => {
  const gm = mkt({ outcomes: '["Yes","No"]', outcomePrices: '["0.62","0.38"]' });
  assert.deepEqual(weather.mapPrices({} as TrackedMarket, gm), { yes: 0.62, no: 0.38 });
});

test("sports.mapPrices maps price_yes to the home team's outcome", () => {
  const gm = mkt({
    outcomes: '["Atlanta Braves","Philadelphia Phillies"]',
    outcomePrices: '["0.45","0.55"]',
  });
  const m = { home_team: "Philadelphia Phillies", away_team: "Atlanta Braves" } as unknown as TrackedMarket;
  assert.deepEqual(sports.mapPrices(m, gm), { yes: 0.55, no: 0.45 });
});

test("sports.mapPrices falls back to outcome order when names don't match", () => {
  const gm = mkt({ outcomes: '["A","B"]', outcomePrices: '["0.3","0.7"]' });
  const m = { home_team: "unknown", away_team: "also unknown" } as unknown as TrackedMarket;
  assert.deepEqual(sports.mapPrices(m, gm), { yes: 0.7, no: 0.3 }); // yes=index1, no=index0
});

test("jsonArray is null-safe", () => {
  assert.deepEqual(jsonArray('["a","b"]'), ["a", "b"]);
  assert.deepEqual(jsonArray(undefined), []);
  assert.deepEqual(jsonArray("not json"), []);
});
