import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://stub"; // config.ts requires it; no connection is made

import { flattenMarkets, expirationMs, LimitlessMarket } from "../src/limitless";

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
