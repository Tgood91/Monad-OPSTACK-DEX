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

test("gate: a real revert says 'Simulation failed', a missing balance or an unrun check does not", async () => {
  const { gateTrade } = await import("../src/bushido-gate.js");
  assert.match(
    gateTrade({ slippagePct: "0.5", sim: { ok: false, reverted: true, reason: "STF" } }).reason,
    /^Simulation failed: STF/,
  );
  assert.match(
    gateTrade({
      slippagePct: "0.5",
      sim: { ok: false, reverted: false, funds: true, reason: "not enough in this wallet to cover this" },
    }).reason,
    /^Not enough in this wallet/,
  );
  assert.match(
    gateTrade({ slippagePct: "0.5", sim: { ok: false, reverted: false, reason: "couldn't check this right now (x)." } })
      .reason,
    /^Couldn't check this right now/,
  );
  assert.match(gateTrade({ slippagePct: "0.5" }).reason, /^Simulation failed: not run/);
});
