import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://stub"; // config.ts requires it; no connection is made

import {
  flattenMarkets, expirationMs, marketFrequency, parseStrike, LimitlessMarket,
} from "../src/limitless";

test("flattenMarkets passes single markets through", () => {
  const m = { slug: "a", title: "A", marketType: "single" } as LimitlessMarket;
  const out = flattenMarkets([m]);
  assert.equal(out.length, 1);
  assert.equal(out[0].groupSlug, null);
  assert.equal(out[0].title, "A");
});

test("flattenMarkets expands groups to child markets with composed titles", () => {
  const group = {
    slug: "spy-week",
    title: "What will SPY hit?",
    marketType: "group",
    categories: ["Crypto"],
    markets: [
      { slug: "spy-800", title: "↑ $800", marketType: "single" },
      { slug: "spy-810", title: "↑ $810", marketType: "single" },
    ],
  } as LimitlessMarket;
  const out = flattenMarkets([group]);
  assert.equal(out.length, 2);
  assert.equal(out[0].groupSlug, "spy-week");
  assert.equal(out[0].title, "What will SPY hit? — ↑ $800");
  assert.deepEqual(out[0].m.categories, ["Crypto"]); // inherited from parent
});

test("flattenMarkets skips group children with no slug", () => {
  const group = {
    slug: "g", title: "G", marketType: "group",
    markets: [{ title: "no slug" } as LimitlessMarket, { slug: "ok", title: "ok" } as LimitlessMarket],
  } as LimitlessMarket;
  assert.equal(flattenMarkets([group]).length, 1);
});

test("expirationMs handles number and numeric-string timestamps", () => {
  assert.equal(expirationMs({ expirationTimestamp: 1788876000000 } as LimitlessMarket), 1788876000000);
  assert.equal(expirationMs({ expirationTimestamp: "1788876000000" } as LimitlessMarket), 1788876000000);
  assert.equal(expirationMs({} as LimitlessMarket), null);
});

test("parseStrike pulls the 'price to beat' from the description", () => {
  assert.equal(
    parseStrike("<p>The price for Pyth Pro BTC/USD captured on September 6, 2026, at 16:00 UTC was $79,713.44093242.</p>"),
    79713.44093242,
  );
  assert.equal(parseStrike("The Price to Beat captured from the same TWAP was $2489.75."), 2489.75);
  assert.equal(parseStrike("no dollar figure here"), null);
  assert.equal(parseStrike(undefined), null);
});

test("marketFrequency reads duration property then tags", () => {
  assert.equal(
    marketFrequency({ properties: [{ propertyKeySlug: "duration", value: ["daily"] }] } as LimitlessMarket),
    "daily",
  );
  assert.equal(marketFrequency({ tags: ["Hourly", "Recurring"] } as LimitlessMarket), "hourly");
  assert.equal(marketFrequency({ tags: ["Sports"] } as LimitlessMarket), null);
});
