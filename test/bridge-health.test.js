import test from "node:test";
import assert from "node:assert/strict";
import { errorStatus } from "../server/bridge-health.js";

test("a route that fails is down", () => {
  assert.equal(errorStatus(new Error("Aori 500 on /quote")), "down");
  assert.equal(errorStatus(new Error("stargate probe timed out")), "down");
});

test("a source that is not set up on this server is 'not configured', not down", () => {
  assert.equal(errorStatus(new Error("connect ENOENT /run/hatch/auth/authd.sock")), "unknown");
  assert.equal(errorStatus(new Error("ONEINCH_API_KEY not set")), "unknown");
  assert.equal(errorStatus(new Error("1inch rejected the API key (401)")), "unknown");
});

import { createTracker, probeRoute, RED_AFTER, COUNT_GAP_MS } from "../server/bridge-health.js";

// A fake clock that only moves when we say so, so the tests never wait.
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    tick: (ms) => {
      t += ms;
    },
  };
}
const boom =
  (msg = "Aori 500 on /quote") =>
  async () => {
    throw new Error(msg);
  };
const fine = async () => {};

test("a working route is live", async () => {
  const c = clock();
  const r = await probeRoute("near", fine, { tracker: createTracker(), now: c.now, sleep: c.sleep });
  assert.equal(r.status, "live");
});

test("a one-off glitch (fails, then works on the quiet retry) is just live: never amber, never red", async () => {
  const c = clock();
  const tracker = createTracker();
  let n = 0;
  const flaky = async () => {
    if (++n === 1) throw new Error("fetch failed");
  };
  const r = await probeRoute("near", flaky, { tracker, key: "k", now: c.now, sleep: c.sleep });
  assert.equal(r.status, "live");
  assert.equal(n, 2);
  assert.equal(tracker.record("k", true).fails, 0);
});

test("a failure that survives the retry is AMBER first, with the count and a 'may be a glitch' note", async () => {
  const c = clock();
  const r = await probeRoute("aori", boom(), { tracker: createTracker(), key: "k", now: c.now, sleep: c.sleep });
  assert.equal(r.status, "degraded");
  assert.match(r.detail, new RegExp(`check 1 of ${RED_AFTER}`));
  assert.match(r.detail, /may be a glitch/);
});

test("only repeated failed checks, a minute or more apart, turn it red", async () => {
  const c = clock();
  const tracker = createTracker();
  const run = () => probeRoute("aori", boom(), { tracker, key: "k", now: c.now, sleep: c.sleep });
  const seen = [];
  for (let i = 0; i < RED_AFTER; i++) {
    seen.push((await run()).status);
    c.tick(COUNT_GAP_MS + 5000);
  }
  assert.deepEqual(seen, ["degraded", "degraded", "down"]);
  assert.match((await run()).detail, /failing for about \d+ min/);
});

test("clicking Re-probe over and over cannot rush a route to red", async () => {
  const c = clock();
  const tracker = createTracker();
  for (let i = 0; i < 10; i++) {
    const r = await probeRoute("aori", boom(), { tracker, key: "k", now: c.now, sleep: c.sleep });
    assert.equal(r.status, "degraded");
    c.tick(2000); // ten checks within twenty seconds still count as one failure
  }
});

test("one good check wipes the slate, so a later hiccup starts counting from 1 again", async () => {
  const c = clock();
  const tracker = createTracker();
  await probeRoute("aori", boom(), { tracker, key: "k", now: c.now, sleep: c.sleep });
  c.tick(COUNT_GAP_MS + 1);
  await probeRoute("aori", boom(), { tracker, key: "k", now: c.now, sleep: c.sleep });
  c.tick(COUNT_GAP_MS + 1);
  await probeRoute("aori", fine, { tracker, key: "k", now: c.now, sleep: c.sleep });
  c.tick(COUNT_GAP_MS + 1);
  const r = await probeRoute("aori", boom(), { tracker, key: "k", now: c.now, sleep: c.sleep });
  assert.match(r.detail, /check 1 of/);
});

test("'not configured' is never retried and never counted towards red", async () => {
  const c = clock();
  const tracker = createTracker();
  let n = 0;
  const r = await probeRoute(
    "fusion",
    async () => {
      n++;
      throw new Error("connect ENOENT /run/hatch/auth/authd.sock");
    },
    { tracker, key: "k", now: c.now, sleep: c.sleep },
  );
  assert.equal(r.status, "unknown");
  assert.equal(n, 1);
  assert.equal(tracker.record("k", true).fails, 0);
});

test("routes are counted separately", async () => {
  const c = clock();
  const tracker = createTracker();
  await probeRoute("aori", boom(), { tracker, key: "aori:base>monad", now: c.now, sleep: c.sleep });
  const other = await probeRoute("aori", boom(), { tracker, key: "aori:monad>base", now: c.now, sleep: c.sleep });
  assert.match(other.detail, /check 1 of/);
});
