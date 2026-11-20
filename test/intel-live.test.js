// Intel tab live answers: what a question is taken to mean, and how the answer is built from the two services.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planQuestion, usd, createIntel, unsupportedAnswer } from "../server/intel-live.js";

test("plans: chain, DEX and kind are read from the question", () => {
  assert.deepEqual(planQuestion("DEX volume on Base"), { chain: "base", dex: null, chainNamed: true, kind: "dexes" });
  assert.equal(planQuestion("Top pools on avax").chain, "avalanche");
  assert.equal(planQuestion("Top pools on avax").kind, "pools");
  assert.deepEqual(planQuestion("sushiswap on base"), {
    chain: "base",
    dex: "sushiswap",
    chainNamed: true,
    kind: "pools",
  });
  assert.equal(planQuestion("PancakeSwap pools").chain, "base"); // no chain named: Base first (the main chain)
  assert.equal(planQuestion("most traded tokens on BNB chain").kind, "tokens");
  assert.equal(planQuestion("compare all chains").kind, "chains");
  assert.equal(planQuestion("Monad").kind, "dexes");
});
test("plans: a word inside another word does not name a chain, and unrelated questions are left alone", () => {
  assert.equal(planQuestion("top pools for database").chainNamed, false);
  assert.equal(planQuestion("How does 1inch Pathfinder split capital?"), null);
  assert.equal(planQuestion(""), null);
});
test("usd formats by size", () => {
  assert.equal(usd(1068809653), "$1.07B");
  assert.equal(usd(34682323), "$34.7M");
  assert.equal(usd(9200), "$9.2K");
  assert.equal(usd(512), "$512");
  assert.equal(usd(undefined), "n/a");
});

const reply = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
const texts = (messages, type) =>
  messages.filter((m) => m.systemMessage.text?.textType === type).flatMap((m) => m.systemMessage.text.parts);

test("DEX volume answer comes from the fetched table, ranked by 7 days, with a 14-day column", async () => {
  const calls = [];
  const intel = createIntel({
    fetchImpl: async (url) => {
      calls.push(url);
      return reply({
        total24h: 100,
        total7d: 1000,
        change_7dover7d: 5,
        protocols: [
          { name: "Small", total24h: 10, total7d: 200, total14dto7d: 100, change_7dover7d: -1 },
          { name: "Big", total24h: 90, total7d: 800, total14dto7d: 700, change_7dover7d: 2 },
          { name: "Dead", total24h: 0, total7d: 0 },
        ],
      });
    },
  });
  const a = await intel.answer("dex volume on base");
  assert.equal(a.live, true);
  assert.deepEqual(a.sources, ["DeFi Llama"]);
  assert.match(calls[0], /overview\/dexs\/Base/);
  const rows = a.messages.find((m) => m.systemMessage.data).systemMessage.data.result.data;
  assert.deepEqual(
    rows.map((r) => r.DEX),
    ["Big", "Small"],
  );
  assert.equal(rows[0]["14 days"], "$1.5K");
  assert.match(texts(a.messages, "FINAL_RESPONSE")[0], /\*\*Big\*\*.*80%/s);
  await intel.answer("dex volume on base");
  assert.equal(calls.length, 1); // second ask is served from the cache
});
test("pools for one DEX: finds that DEX on the chain, then ranks its pools", async () => {
  const calls = [];
  const pool = (name, vol, dex) => ({
    attributes: {
      name,
      volume_usd: { h24: String(vol) },
      reserve_in_usd: "5000",
      price_change_percentage: { h24: "1.5" },
    },
    relationships: {
      dex: { data: { id: dex } },
      base_token: { data: { id: "t1" } },
      quote_token: { data: { id: "t2" } },
    },
  });
  const intel = createIntel({
    fetchImpl: async (url) => {
      calls.push(url);
      if (/\/dexes\?/.test(url)) return reply({ data: [{ id: "uniswap-v3-monad" }, { id: "pancakeswap-v3-monad" }] });
      return reply({
        data: [pool("A / B", 10, "pancakeswap-v3-monad"), pool("C / D", 900, "pancakeswap-v3-monad")],
        included: [],
      });
    },
  });
  const a = await intel.answer("PancakeSwap on Monad");
  assert.deepEqual(a.sources, ["GeckoTerminal"]);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /dexes\/pancakeswap-v3-monad\/pools/);
  const rows = a.messages.find((m) => m.systemMessage.data).systemMessage.data.result.data;
  assert.deepEqual(
    rows.map((r) => r.Pool),
    ["C / D", "A / B"],
  );
});
test("a failed read says so and shows no figures", async () => {
  const intel = createIntel({ fetchImpl: async () => reply({}, false, 503) });
  const a = await intel.answer("dex volume on monad");
  assert.equal(a.failed, true);
  assert.equal(a.messages.length, 1);
  assert.match(texts(a.messages, "FINAL_RESPONSE")[0], /Could not read DeFi Llama/);
});
test("a question that is not about live data returns null; the reply says so instead of inventing figures", async () => {
  const intel = createIntel({ fetchImpl: async () => assert.fail("no fetch expected") });
  assert.equal(await intel.answer("Explain 0xSplits post-swap distribution"), null);
  const u = unsupportedAnswer();
  assert.equal(u.live, false);
  assert.equal(u.unsupported, true);
  assert.match(texts(u.messages, "FINAL_RESPONSE")[0], /only answer from live data/);
  assert.ok(!u.messages.some((m) => m.systemMessage.data || m.systemMessage.chart));
});
test("Merkl answer ranks live campaigns by daily rewards and picks the best rate only among deep ones", async () => {
  const calls = [];
  const intel = createIntel({
    fetchImpl: async (url) => {
      calls.push(url);
      return reply([
        { name: "Lend USDC", protocol: { name: "Aave" }, dailyRewards: 4000, apr: 5.5, tvl: 100000000 },
        { name: "Tiny pool", protocol: { name: "PancakeSwap" }, dailyRewards: 40, apr: 210, tvl: 7600 },
        { name: "LP MON-USDC", protocol: { name: "Uniswap" }, dailyRewards: 900, apr: 31, tvl: 900000 },
        { name: "Ended", protocol: { name: "X" }, dailyRewards: 0, apr: 0, tvl: 5 },
      ]);
    },
  });
  assert.equal(planQuestion("alpha on merkl").kind, "merkl");
  const a = await intel.answer("Merkl rewards on Monad");
  assert.deepEqual(a.sources, ["Merkl"]);
  assert.match(calls[0], /opportunities\?chainId=143&status=LIVE/);
  const rows = a.messages.find((m) => m.systemMessage.data).systemMessage.data.result.data;
  assert.deepEqual(
    rows.map((r) => r.Campaign),
    ["Lend USDC", "Tiny pool", "LP MON-USDC"],
  );
  const text = texts(a.messages, "FINAL_RESPONSE")[0];
  assert.match(text, /Best rate among campaigns holding at least \$100K: \*\*LP MON-USDC\*\* at 31\.0% APR/);
  assert.doesNotMatch(text, /210/);
});

test("GeckoTerminal 429: waits, retries once, then answers", async () => {
  let n = 0;
  const waits = [];
  const body = { data: [], included: [] };
  const intel = createIntel({
    fetchImpl: async () => (++n === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => body }),
    sleep: async (ms) => waits.push(ms),
  });
  const a = await intel.answer("top pools on base");
  assert.equal(a.failed, undefined);
  assert.equal(n, 2);
  assert.equal(waits.length, 1);
});
test("GeckoTerminal keeps answers 15 minutes; a refusal after that serves the saved copy, marked stale", async () => {
  let t = Date.parse("2026-11-17T10:00:00Z");
  let refuse = false;
  let n = 0;
  const body = { data: [], included: [] };
  const intel = createIntel({
    now: () => t,
    sleep: async () => {},
    fetchImpl: async () => (n++, refuse ? { ok: false, status: 429 } : { ok: true, json: async () => body }),
  });
  await intel.answer("top pools on base");
  t += 10 * 60 * 1000;
  await intel.answer("top pools on base");
  assert.equal(n, 1); // still fresh at 10 minutes
  t += 10 * 60 * 1000;
  refuse = true;
  const a = await intel.answer("top pools on base");
  assert.equal(n, 3); // tried and retried
  assert.equal(a.failed, undefined);
  assert.equal(a.stale, true);
  assert.equal(a.asOf, "2026-11-17T10:00:00.000Z"); // labelled with when it was really read
});
test("a refusal with nothing saved still says plainly it could not read", async () => {
  const intel = createIntel({ sleep: async () => {}, fetchImpl: async () => ({ ok: false, status: 429 }) });
  const a = await intel.answer("top pools on base");
  assert.equal(a.failed, true);
});
