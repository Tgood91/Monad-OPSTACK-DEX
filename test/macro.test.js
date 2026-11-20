import test from "node:test";
import assert from "node:assert/strict";
import { createMacro, blend, MARKETS } from "../server/macro.js";
import { createMarketData, GECKO, COINBASE } from "../server/market-data.js";
import { CHAINS } from "../src/dex/chains.js";

const addrOf = (sym) => CHAINS.base.tokens.find((t) => t.symbol === sym).address;
const poolOf = (sym) => "0x" + Buffer.from(sym.padEnd(20, "_")).toString("hex").slice(0, 40);

// 60 daily closes, oldest first: rising or falling.
const series = (dir, n = 60) => Array.from({ length: n }, (_, i) => 100 + (dir === "down" ? -i : i));

/**
 * Fake network. `trend` per Coinbase product ("ETH-USD": "down"); `refuse` lists URL parts that answer 429;
 * `fail` lists URL parts that answer 500. GeckoTerminal pools always rise.
 */
function fakeNet({ trend = {}, refuse = [], fail = [] } = {}) {
  const calls = [];
  const json = (body, status = 200) => ({
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
  });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (refuse.some((r) => url.includes(r))) return json({}, 429);
    if (fail.some((r) => url.includes(r))) return json({}, 500);
    if (url.startsWith(`${COINBASE}/products/`)) {
      const product = url.split("/products/")[1].split("/")[0];
      // Coinbase answers newest first: [time, low, high, open, close, volume]
      return json(
        series(trend[product] || "up")
          .map((c, i) => [i, c, c, c, c, 500])
          .reverse(),
      );
    }
    if (url.startsWith(`${GECKO}/networks/base/tokens/multi/`)) {
      const addrs = url.split("/multi/")[1].split("?")[0].split(",");
      return json({
        data: addrs.map((a) => {
          const sym = MARKETS.find((m) => addrOf(m.symbol).toLowerCase() === a.toLowerCase()).symbol;
          return {
            attributes: { address: a.toLowerCase() },
            relationships: { top_pools: { data: [{ id: `base_${poolOf(sym)}` }] } },
          };
        }),
      });
    }
    if (url.startsWith(`${GECKO}/networks/base/pools/`)) {
      // GeckoTerminal answers newest first: [time, open, high, low, close, volume]
      return json({
        data: {
          attributes: {
            ohlcv_list: series("up")
              .map((c, i) => [i, c, c, c, c, 1000])
              .reverse(),
          },
        },
      });
    }
    throw new Error("unexpected url " + url);
  };
  return { fetchImpl, calls, count: (part) => calls.filter((u) => u.includes(part)).length };
}

function feed(net, clock = { t: 1_800_000_000_000 }) {
  const now = () => clock.t;
  const data = createMarketData({ fetchImpl: net.fetchImpl, now, sleep: async () => {} });
  return { ...createMacro({ data, now, virtueScores: async () => ({ scores: {} }) }), clock };
}

test("the regime comes from five markets on Coinbase; GeckoTerminal is not asked and Yahoo never is", async () => {
  const net = fakeNet();
  const d = await feed(net).macroFeed();
  assert.equal(d.regime, "RISK-ON");
  assert.equal(d.regimeScore, 5);
  assert.equal(d.marketsAvailable, 5);
  assert.deepEqual(
    d.factors.map((f) => [f.id, f.source]),
    MARKETS.map((m) => [m.id, "Coinbase"]),
  );
  assert.deepEqual(
    MARKETS.map((m) => m.coinbase),
    ["ETH-USD", "BTC-USD", "AERO-USD", "VIRTUAL-USD", "DEGEN-USD"],
  );
  assert.equal(net.count("/candles?granularity=86400"), 5);
  assert.equal(net.count(GECKO), 0);
  assert.ok(!net.calls.some((u) => /yahoo/i.test(u)));
  assert.equal(d.signals.length, 5);
});

test("falling markets are RISK-OFF; a 3-2 split is NEUTRAL", async () => {
  const down = Object.fromEntries(MARKETS.map((m) => [m.coinbase, "down"]));
  assert.equal((await feed(fakeNet({ trend: down })).getMarket()).regime, "RISK-OFF");
  const split = { "ETH-USD": "down", "BTC-USD": "down" };
  const m = await feed(fakeNet({ trend: split })).getMarket();
  assert.equal(m.regimeScore, 1);
  assert.equal(m.regime, "NEUTRAL");
});

test("a market Coinbase cannot answer falls back to its GeckoTerminal pool (looked up once, only then)", async () => {
  const net = fakeNet({ refuse: ["DEGEN-USD"] });
  const m = await feed(net).getMarket();
  const degen = m.factors.find((f) => f.id === "degen");
  assert.equal(degen.available, true);
  assert.equal(degen.source, "GeckoTerminal");
  assert.equal(net.count("DEGEN-USD"), 3); // first try + two retries
  assert.equal(net.count("/tokens/multi/"), 1);
  assert.equal(net.count("/ohlcv/day"), 1);
  assert.ok(net.calls.some((u) => u.includes("/tokens/multi/") && u.includes(addrOf("DEGEN"))));
  assert.equal(m.factors.find((f) => f.id === "eth").source, "Coinbase");
});

test("with fewer than 3 markets readable the regime is UNAVAILABLE, and the verdict says so", async () => {
  const net = fakeNet({ fail: ["AERO-USD", "VIRTUAL-USD", "DEGEN-USD", "/tokens/multi/"] });
  const m = await feed(net).getMarket();
  assert.equal(m.marketsAvailable, 2);
  assert.equal(m.regime, "UNAVAILABLE");
  assert.deepEqual(
    m.factors.filter((f) => f.available).map((f) => f.id),
    ["eth", "btc"],
  );
  assert.equal(blend("HOLD_LONG", "UNAVAILABLE", "open"), "LONG (regime unavailable)");
  assert.equal(blend("SELL", "UNAVAILABLE", "open"), "SHORT (regime unavailable)");
  assert.equal(blend("WAIT", "UNAVAILABLE", "open"), "WAIT");
});

test("caching: the market 5 minutes, candles 30 minutes", async () => {
  const net = fakeNet();
  const f = feed(net);
  await f.getMarket();
  f.clock.t += 4 * 60_000;
  assert.equal((await f.getMarket()).cached, true);
  f.clock.t += 2 * 60_000; // 6 minutes: recomputed, but from the cached candles
  assert.equal((await f.getMarket()).cached, false);
  assert.equal(net.count("/candles?granularity=86400"), 5);
  f.clock.t += 31 * 60_000; // candles expired: asked again
  await f.getMarket();
  assert.equal(net.count("/candles?granularity=86400"), 10);
});

test("a 429 followed by an answer is retried, not reported as missing", async () => {
  let first = true;
  const base = fakeNet();
  const fetchImpl = async (url) => {
    if (first && url.includes("/candles")) {
      first = false;
      return { ok: false, status: 429, headers: { get: () => "1" }, json: async () => ({}) };
    }
    return base.fetchImpl(url);
  };
  const now = () => 1_800_000_000_000;
  const m = await createMacro({ data: createMarketData({ fetchImpl, now, sleep: async () => {} }), now }).getMarket();
  assert.equal(m.marketsAvailable, 5);
  assert.ok(m.factors.every((f) => f.source === "Coinbase"));
});

test("stale copy: after the cache expires and Coinbase refuses, the last good candles are used", async () => {
  let refuse = false;
  const base = fakeNet();
  const fetchImpl = async (url) =>
    refuse && url.includes("/candles")
      ? { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }
      : base.fetchImpl(url);
  const clock = { t: 1_800_000_000_000 };
  const now = () => clock.t;
  const { getMarket } = createMacro({ data: createMarketData({ fetchImpl, now, sleep: async () => {} }), now });
  await getMarket();
  refuse = true;
  clock.t += 31 * 60_000;
  const m = await getMarket();
  assert.equal(m.marketsAvailable, 5);
  assert.ok(m.factors.every((f) => f.source === "Coinbase" && f.stale === true));
});
