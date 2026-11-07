import test from "node:test";
import assert from "node:assert/strict";
import { resilient, isTransient, _resetPauses, pausedFor } from "../src/dex/resilience.js";

const fast = { sleep: async () => {} };

test("classifies errors", () => {
  assert.equal(isTransient(new Error("Aori 500 on /quote")), true);
  assert.equal(isTransient(new Error("timeout (kyberswap)")), false);
  assert.equal(isTransient(new Error("API key not set")), false);
  assert.equal(isTransient(new Error("no liquidity")), false);
});

test("retries a transient failure once, then succeeds", async () => {
  _resetPauses(); let n = 0;
  const r = await resilient("a", async () => { if (++n === 1) throw new Error("Aori 500"); return "ok"; }, fast);
  assert.equal(r, "ok"); assert.equal(n, 2);
});

test("gives up after one retry and pauses the service for 60s", async () => {
  _resetPauses(); let n = 0; let t = 1000;
  const o = { ...fast, now: () => t };
  await assert.rejects(resilient("b", async () => { n++; throw new Error("Aori 500"); }, o), /500/);
  assert.equal(n, 2);
  await assert.rejects(resilient("b", async () => { n++; return 1; }, o), /temporarily unavailable/);
  assert.equal(n, 2); // not called while paused
  t += 61_000;
  assert.equal(await resilient("b", async () => "back", o), "back");
});

test("permanent errors are not retried or paused", async () => {
  _resetPauses(); let n = 0;
  await assert.rejects(resilient("c", async () => { n++; throw new Error("API key not set"); }, fast));
  assert.equal(n, 1); assert.equal(pausedFor("c"), 0);
});

test("pause grows on repeated failures and resets after a success", async () => {
  _resetPauses(); let t = 0;
  const o = { sleep: async () => {}, now: () => t };
  const bad = async () => { throw new Error("Aori 500"); };
  await assert.rejects(resilient("d", bad, o));
  assert.equal(pausedFor("d", t), 60_000);
  t += 61_000;
  await assert.rejects(resilient("d", bad, o));
  assert.equal(pausedFor("d", t), 120_000);
  t += 121_000;
  await assert.rejects(resilient("d", bad, o));
  assert.equal(pausedFor("d", t), 300_000);
  t += 301_000;
  assert.equal(await resilient("d", async () => "up", o), "up");
  await assert.rejects(resilient("d", bad, o));
  assert.equal(pausedFor("d", t), 60_000); // back to the start
});
