// Bridge health monitor (server-side).
//
// Probes every bridge source with a real 1-USDC quote on its canary routes
// and classifies each route:
//   live     — quote returned in <= 4s
//   degraded — quote returned, but slow (> 4s)
//   down     — quote failed (route paused, source erroring, or timing out)
//   unknown  — the source is not configured on this server (e.g. no API key)
// A successful quote means deposits are open on the source chain AND payout
// is available on the destination for that pair right now — a failed quote
// is the earliest sign a route has been paused.
//
// Probes are READ-ONLY: quotes are built against a fixed probe wallet and
// never submitted. No deposits are made and no funds ever move.
// Results are cached for 5 minutes; GET /api/bridge/health?refresh=1
// forces a fresh probe round.

import { dryQuote, resolveAsset } from "./near.js";
import { stargateQuote } from "./stargate.js";
import { aoriQuote, getChains } from "./aori.js";
import { fusionQuote } from "./oneinch-fusion.js";

const PROBE_WALLET = "0xBA397fAae1D5Fe10C0356f2e585bef34577ab111"; // quote-only
const AMOUNT = "1000000"; // 1 USDC (6 decimals)
const TIMEOUT_MS = 15000;
const SLOW_MS = 4000;
const CACHE_MS = 5 * 60_000;

const CHAIN_NAME = { 1: "Ethereum", 8453: "Base", 143: "Monad", 10: "Optimism", 42161: "Arbitrum" };
const USDC = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  143: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
};

function withTimeout(p, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} probe timed out`)), TIMEOUT_MS)),
  ]);
}

export function errorStatus(e) {
  const m = String(e?.message || e);
  // Missing key / vault surrogate / auth problems, or the vault socket not existing on this
  // machine (ENOENT .../authd.sock), mean "not configured here", not "the bridge is down".
  return /not set|surrogate|api key|unauthor|401|403|ENOENT|authd/i.test(m) ? "unknown" : "down";
}

// A route only turns RED once it has stayed broken. One failed check is very often a glitch, so:
//   1. a quick failure is retried once right away; if the retry works, the route is simply live;
//   2. a failure that survives the retry shows AMBER ("having trouble, check 1 of 3, may be a glitch");
//   3. only RED_AFTER failed checks in a row, at least COUNT_GAP_MS apart, make it red ("down").
// "Re-probe" clicks cannot rush a route to red: a route's failure is counted at most once a minute.
export const RED_AFTER = 3;
export const COUNT_GAP_MS = 60_000;
export const RETRY_DELAY_MS = 1500;
const QUICK_FAIL_MS = 8000; // a failure that already took this long is a timeout, not a hiccup: no retry

export function createTracker({ redAfter = RED_AFTER, gapMs = COUNT_GAP_MS } = {}) {
  const seen = new Map(); // route key -> { fails, since, lastCount }
  return {
    record(key, ok, now = Date.now()) {
      if (ok) {
        seen.delete(key);
        return { fails: 0, since: null, red: false };
      }
      const r = seen.get(key) || { fails: 0, since: now, lastCount: 0 };
      if (r.fails === 0 || now - r.lastCount >= gapMs) {
        r.fails += 1;
        r.lastCount = now;
      }
      seen.set(key, r);
      return { fails: r.fails, since: r.since, red: r.fails >= redAfter };
    },
  };
}

const sharedTracker = createTracker();

export async function probeRoute(
  sourceId,
  run,
  {
    tracker = sharedTracker,
    key = sourceId,
    now = () => Date.now(),
    sleep = (t) => new Promise((r) => setTimeout(r, t)),
    delayMs = RETRY_DELAY_MS,
  } = {},
) {
  const t0 = now();
  const attempt = async () => {
    await withTimeout(run(), sourceId);
  };
  let failure = null;
  try {
    await attempt();
  } catch (e) {
    failure = e;
  }
  if (failure && errorStatus(failure) === "down" && now() - t0 < QUICK_FAIL_MS) {
    await sleep(delayMs); // glitch filter: one quiet retry
    const t1 = now();
    try {
      await attempt();
      failure = null;
      const ms = now() - t1;
      tracker.record(key, true, now());
      return { status: ms > SLOW_MS ? "degraded" : "live", ms };
    } catch (e) {
      failure = e;
    }
  }
  const ms = now() - t0;
  if (!failure) {
    tracker.record(key, true, now());
    return { status: ms > SLOW_MS ? "degraded" : "live", ms };
  }
  if (errorStatus(failure) === "unknown") {
    // "Not configured" is about this server, not the bridge: don't show internal paths or keys.
    return { status: "unknown", ms, detail: "not set up on this server" };
  }
  const rec = tracker.record(key, false, now());
  const msg = String(failure?.message || failure).slice(0, 120);
  if (rec.red) {
    const mins = Math.max(1, Math.round((now() - rec.since) / 60000));
    return { status: "down", ms, detail: `${msg} (failing for about ${mins} min)`, fails: rec.fails };
  }
  return {
    status: "degraded",
    ms,
    detail: `${msg} (check ${rec.fails} of ${RED_AFTER}, may be a glitch)`,
    fails: rec.fails,
  };
}

/* ---- per-source quote probes (same calls the bridge routes make) ---- */

async function nearRoute(fromId, toId) {
  const [o, d] = await Promise.all([resolveAsset(fromId, USDC[fromId]), resolveAsset(toId, USDC[toId])]);
  await dryQuote({
    originAsset: o.assetId,
    destinationAsset: d.assetId,
    amount: AMOUNT,
    refundTo: PROBE_WALLET,
    recipient: PROBE_WALLET,
    slippageBps: 100,
  });
}

async function stargateRoute(fromId, toId) {
  await stargateQuote({
    fromChainId: fromId,
    toChainId: toId,
    tokenRef: "USDC",
    amountAtomic: AMOUNT,
    recipient: PROBE_WALLET,
  });
}

let aoriKeys = null;
async function aoriKey(chainId) {
  if (!aoriKeys) {
    const chains = await getChains();
    aoriKeys = {};
    for (const c of chains || []) if (c.chainId != null) aoriKeys[Number(c.chainId)] = c.chainKey;
  }
  const k = aoriKeys[chainId];
  if (!k) throw new Error(`aori does not list chain ${chainId}`);
  return k;
}
async function aoriRoute(fromId, toId) {
  const [fromChainKey, toChainKey] = await Promise.all([aoriKey(fromId), aoriKey(toId)]);
  await aoriQuote({
    fromChainKey,
    toChainKey,
    fromToken: USDC[fromId],
    toToken: USDC[toId],
    amountAtomic: AMOUNT,
    wallet: PROBE_WALLET,
  });
}

async function fusionRoute(fromId, toId) {
  await fusionQuote({
    srcChainId: fromId,
    dstChainId: toId,
    srcToken: USDC[fromId],
    dstToken: USDC[toId],
    amountAtomic: AMOUNT,
    wallet: PROBE_WALLET,
  });
}

const SOURCES = [
  {
    id: "near",
    name: "NEAR Intents",
    run: nearRoute,
    routes: [
      [8453, 143],
      [143, 8453],
    ],
  },
  {
    id: "stargate",
    name: "Stargate",
    run: stargateRoute,
    routes: [
      [8453, 42161],
      [8453, 10],
    ],
  },
  {
    id: "aori",
    name: "Aori",
    run: aoriRoute,
    routes: [
      [8453, 143],
      [143, 8453],
    ],
  },
  { id: "fusion", name: "1inch Fusion+", run: fusionRoute, routes: [[8453, 143]] },
];

function aggregate(routes) {
  const s = routes.map((r) => r.status);
  if (s.every((x) => x === "unknown")) return "unknown";
  const known = s.filter((x) => x !== "unknown");
  if (known.every((x) => x === "live")) return "live";
  if (known.every((x) => x === "down")) return "down";
  return "degraded"; // any mix, or any slow route
}

/* ---- cached probe round ---- */

let cache = { at: 0, data: null };
let inflight = null;

export async function bridgeHealth({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    const sources = await Promise.all(
      SOURCES.map(async (s) => {
        const routes = await Promise.all(
          s.routes.map(async ([f, t]) => ({
            from: CHAIN_NAME[f] || String(f),
            to: CHAIN_NAME[t] || String(t),
            asset: "USDC",
            ...(await probeRoute(s.id, () => s.run(f, t), { key: `${s.id}:${f}>${t}` })),
          })),
        );
        return { id: s.id, name: s.name, status: aggregate(routes), routes };
      }),
    );
    const data = { checkedAt: new Date().toISOString(), probe: "1 USDC quote per route, read-only", sources };
    cache = { at: Date.now(), data };
    return data;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
