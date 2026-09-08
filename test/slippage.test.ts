import { test } from "node:test";
import assert from "node:assert/strict";

import { vwapFill, computeSlippage } from "../src/slippage";

test("vwapFill single level, order smaller than the level", () => {
  // 1000 shares offered at 0.60 = $600 available; buying $300 → all at 0.60
  assert.equal(vwapFill([{ price: 0.6, size: 1000 }], 300), 0.6);
});

test("vwapFill walks multiple levels weighted by USDC taken", () => {
  // level 1: 100 sh @ 0.50 = $50 ; level 2: 100 sh @ 0.60 = $60
  // buy $80 → $50 at 0.50 (100 sh) + $30 at 0.60 (50 sh) → vwap = 80 / 150
  const v = vwapFill([{ price: 0.5, size: 100 }, { price: 0.6, size: 100 }], 80);
  assert.ok(v !== null && Math.abs(v - 80 / 150) < 1e-9);
});

test("vwapFill returns partial-book VWAP when the book can't fill the size", () => {
  // only $30 available, asked for $1000 → vwap of the whole book (0.30)
  assert.equal(vwapFill([{ price: 0.3, size: 100 }], 1000), 0.3);
});

test("vwapFill null on empty book", () => {
  assert.equal(vwapFill([], 100), null);
});

test("computeSlippage: buy above mid, sell below mid, positive both ways", () => {
  const bids = [{ price: 0.48, size: 10_000 }];
  const asks = [{ price: 0.52, size: 10_000 }];
  const s = computeSlippage(bids, asks, 0.5, [50, 250]);
  assert.ok(s);
  assert.equal(s!.buy["50"], 0.02); // 0.52 - 0.50
  assert.equal(s!.sell["50"], 0.02); // 0.50 - 0.48
  assert.equal(s!.buy["250"], 0.02);
});

test("computeSlippage null when no midpoint or empty book", () => {
  assert.equal(computeSlippage([], [], 0.5, [50]), null);
  assert.equal(computeSlippage([{ price: 0.4, size: 1 }], [], null, [50]), null);
});
