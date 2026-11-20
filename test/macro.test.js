import test from "node:test";
import assert from "node:assert/strict";
import { createMacro, blend, MARKETS } from "../server/macro.js";
import { createMarketData, GECKO, COINBASE } from "../server/market-data.js";
import { CHAINS } from "../src/dex/chains.js";

const addrOf = (sym) => CHAINS.base.tokens.find((t) => t.symbol === sym).address;
const poolOf = (sym) => "0x" + Buffer.from(sym.padEnd(20, "_")).toString("hex").slice(0, 40);

// 60 daily closes, oldest first: rising, falling or flat.
const series = (dir, n = 60) => Array.from({ length: n }, (_, i) => 100 + (dir === "up" ? i : dir === "down" ? -i : 0));

/** Fake network. `trend` per symbol: "up" | "down"; `refuse` lists URL parts that answer 429; `fail` -> 500. */
function fakeNet({ trend = {}, refuse = [], fail = [], coinbase = {} } = {}) {
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
      const sym = MARKETS.find((m) => url.includes(poolOf(m.symbol))).symbol;
      const closes = series(trend[sym] || "up");
      // GeckoTerminal answers newest first: [time, open, high, low, close, volume]
      const rows = closes.map((c, i) => [i, c, c, c, c, 1000]).reverse();
      return json({ data: { attributes: { ohlcv_list: rows } } });
    }
    if (url.startsWith(`${COINBASE}/products/`)) {
      const product = url.split("/products/")[1].split("/")[0];
      const closes = series(coinbase[product] || "up");
      // Coinbase answers newest first: [time, low, high, open, close, volume]
      return json(closes.map((c, i) => [i, c, c, c, c, 500]).reverse());
    }
    throw new Error("unexpected url " + url);
  };
  return { fetchImpl, calls };
}

function feed(net, clock = { t: 1_800_000_000_000 }) {
  const now = () => clock.t;
  const data = createMarketData({ fetchImpl: net.fetchImpl, now, sleep: async () => {} });
  return { ...createMacro({ data, now, virtueScores: async () => ({ scores: {} }) }), clock };
}

test("the regime comes from five Base markets on GeckoTerminal; Yahoo is never asked", async () => {
  const net = fakeNet();
  const { macroFeed } = feed(net);
  const d = await macroFeed();
  assert.equal(d.regime, "RISK-ON");
  assert.equal(d.regimeScore, 5);
  assert.equal(d.marketsAvailable, 5);
  assert.deepEqual(
    d.factors.map((f) => [f.id, f.source]),
    MARKETS.map((m) => [m.id, "GeckoTerminal"]),
  );
  assert.ok(!net.calls.some((u) => /yahoo/i.test(u)));
  // One call finds every pool; then one call per market.
  assert.equal(net.calls.filter((u) => u.includes("/tokens/multi/")).length, 1);
  assert.equal(net.calls.filter((u) => u.includes("/ohlcv/day")).length, 5);
  assert.ok(net.calls.every((u) => !u.includes("/ohlcv/") || u.includes("currency=usd")));
  assert.equal(d.signals.length, 5);
});

test("falling markets are RISK-OFF; a 3-2 split is NEUTRAL", async () => {
  const down = { ETH: "down", cbBTC: "down", AERO: "down", VIRTUAL: "down", DEGEN: "down" };
  assert.equal((await feed(fakeNet({ trend: down })).getMarket()).regime, "RISK-OFF");
  const split = { ETH: "down", cbBTC: "down", AERO: "up", VIRTUAL: "up", DEGEN: "up" };
  const m = await feed(fakeNet({ trend: split })).getMarket();
  assert.equal(m.regimeScore, 1);
  assert.equal(m.regime, "NEUTRAL");
});

test("ETH falls back to Coinbase when GeckoTerminal keeps refusing its candles", async () => {
  const ethPool = poolOf("ETH");
  const net = fakeNet({ refuse: [ethPool] });
  const m = await feed(net).getMarket();
  const eth = m.factors.find((f) => f.id === "eth");
  assert.equal(eth.available, true);
  assert.equal(eth.source, "Coinbase");
  assert.equal(net.calls.filter((u) => u.includes(ethPool)).length, 3); // first try + two retries
  assert.ok(net.calls.some((u) => u.includes("/products/ETH-USD/candles")));
});

test("with fewer than 3 markets readable the regime is UNAVAILABLE, and the verdict says so", async () => {
  // The pool lookup fails: only ETH and BTC can be read, from Coinbase.
  const m = await feed(fakeNet({ fail: ["/tokens/multi/"] })).getMarket();
  assert.equal(m.marketsAvailable, 2);
  assert.equal(m.regime, "UNAVAILABLE");
  assert.deepEqual(
    m.factors.filter((f) => f.available).map((f) => f.source),
    ["Coinbase", "Coinbase"],
  );
  assert.equal(blend("HOLD_LONG", "UNAVAILABLE", "open"), "LONG (regime unavailable)");
  assert.equal(blend("SELL", "UNAVAILABLE", "open"), "SHORT (regime unavailable)");
  assert.equal(blend("WAIT", "UNAVAILABLE", "open"), "WAIT");
});

test("caching: the market 5 minutes, candles 30 minutes, pools a day", async () => {
  const net = fakeNet();
  const f = feed(net);
  await f.getMarket();
  const count = (part) => net.calls.filter((u) => u.includes(part)).length;
  f.clock.t += 4 * 60_000;
  assert.equal((await f.getMarket()).cached, true);
  f.clock.t += 2 * 60_000; // 6 minutes: recomputed, but from the cached candles
  assert.equal((await f.getMarket()).cached, false);
  assert.equal(count("/ohlcv/day"), 5);
  f.clock.t += 31 * 60_000; // candles expired: asked again; the pool lookup is still cached
  await f.getMarket();
  assert.equal(count("/ohlcv/day"), 10);
  assert.equal(count("/tokens/multi/"), 1);
});

test("a 429 followed by an answer is retried, not reported as missing", async () => {
  let first = true;
  const base = fakeNet();
  const fetchImpl = async (url) => {
    if (first && url.includes("/ohlcv/day")) {
      first = false;
      return { ok: false, status: 429, headers: { get: () => "1" }, json: async () => ({}) };
    }
    return base.fetchImpl(url);
  };
  const now = () => 1_800_000_000_000;
  const data = createMarketData({ fetchImpl, now, sleep: async () => {} });
  const m = await createMacro({ data, now }).getMarket();
  assert.equal(m.marketsAvailable, 5);
  assert.ok(m.factors.every((f) => f.source === "GeckoTerminal"));
});

test("stale copy: after the cache expires and GeckoTerminal refuses, the last good candles are used", async () => {
  let refuse = false;
  const base = fakeNet();
  const fetchImpl = async (url) =>
    refuse && url.includes("/ohlcv/day")
      ? { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }
      : base.fetchImpl(url);
  const clock = { t: 1_800_000_000_000 };
  const now = () => clock.t;
  const data = createMarketData({ fetchImpl, now, sleep: async () => {} });
  const { getMarket } = createMacro({ data, now });
  await getMarket();
  refuse = true;
  clock.t += 31 * 60_000;
  const m = await getMarket();
  assert.equal(m.marketsAvailable, 5);
  assert.ok(m.factors.every((f) => f.source === "GeckoTerminal" && f.stale === true));
});
