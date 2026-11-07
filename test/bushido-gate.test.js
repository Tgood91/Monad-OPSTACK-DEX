import test from "node:test";
import assert from "node:assert/strict";
import { checkSlippage, gateTrade } from "../src/bushido-gate.js";

test("slippage bounds 0.1%-1%", () => {
  assert.equal(checkSlippage("0.05").ok, false);
  assert.equal(checkSlippage("1.01").ok, false);
  assert.equal(checkSlippage("abc").ok, false);
  assert.deepEqual(checkSlippage("0.5"), { ok: true, bps: 50 });
  assert.equal(checkSlippage("0.1").bps, 10);
  assert.equal(checkSlippage("1").bps, 100);
});

test("gate needs passing simulation", () => {
  assert.equal(gateTrade({ slippagePct: "0.5", sim: { ok: false, reason: "revert" } }).allowed, false);
  assert.equal(gateTrade({ slippagePct: "0.5" }).allowed, false);
  assert.equal(gateTrade({ slippagePct: "2", sim: { ok: true } }).allowed, false);
  assert.equal(gateTrade({ slippagePct: "0.5", sim: { ok: true } }).allowed, true);
});
