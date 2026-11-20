// Market data for the regime feed (server/macro.js): daily USD prices from GeckoTerminal, with Coinbase as the
// backup for ETH and BTC. Both are keyless.
//
// GeckoTerminal (CoinGecko's on-chain DEX data) allows about 30 calls a minute per IP, and the Intel tab uses it
// too, so this client is careful with it:
//   * one call finds the top pool of every coin at once (tokens/multi?include=top_pools), kept for a day;
//   * one call per coin for its daily candles, kept for 30 minutes (they are daily candles);
//   * calls go one at a time with a small gap; a 429, a 5xx or a timeout gets up to two retries, waiting longer
//     each time (and at least what a Retry-After header asks, up to 5 seconds);
//   * if it still refuses, the last good copy is used (marked stale); with no copy, the call fails.
// Coinbase's public candles are not as tightly limited; they get the same cache and retries.

export const GECKO = "https://api.geckoterminal.com/api/v2";
export const COINBASE = "https://api.exchange.coinbase.com";
const DAY_MS = 24 * 3600_000;
const CANDLE_TTL_MS = 30 * 60_000;

export function createMarketData({
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  gapMs = 600,
  retryMs = 1500,
  retries = 2,
  timeoutMs = 10_000,
} = {}) {
  const cache = new Map(); // url -> { at, data }
  let geckoQueue = Promise.resolve();
  let lastGecko = 0;

  async function fetchJson(url, headers = {}) {
    let r;
    try {
      r = await fetchImpl(url, {
        headers: { Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = new Error(`unreachable (${e?.name || "error"})`);
      err.retry = true;
      throw err;
    }
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      err.retry = r.status === 429 || r.status >= 500;
      const after = Number(r.headers?.get?.("retry-after"));
      if (Number.isFinite(after) && after > 0) err.retryAfterMs = Math.min(5000, after * 1000);
      throw err;
    }
    return r.json();
  }

  /** Cached GET with retries; after a refusal the last good copy is returned with `stale: true`. */
  async function cachedGet(url, ttlMs, { headers, paced } = {}) {
    const hit = cache.get(url);
    if (hit && now() - hit.at < ttlMs) return { data: hit.data, at: hit.at, stale: false };
    const once = async () => {
      if (paced) {
        const wait = lastGecko + gapMs - now();
        if (wait > 0) await sleep(wait);
        lastGecko = now();
      }
      return fetchJson(url, headers);
    };
    try {
      let data;
      for (let attempt = 0; ; attempt++) {
        try {
          data = await once();
          break;
        } catch (e) {
          if (!e.retry || attempt >= retries) throw e;
          await sleep(Math.max(retryMs * (attempt + 1), e.retryAfterMs || 0));
        }
      }
      cache.set(url, { at: now(), data });
      return { data, at: now(), stale: false };
    } catch (e) {
      if (hit) return { data: hit.data, at: hit.at, stale: true };
      throw e;
    }
  }

  // GeckoTerminal calls run one at a time (its rate limit is per IP); cache hits skip the line.
  function gecko(url, ttlMs) {
    const run = () => cachedGet(url, ttlMs, { paced: true });
    const p = geckoQueue.then(run, run);
    geckoQueue = p.catch(() => {});
    return p;
  }

  return {
    /** Map of lower-cased token address -> address of its top pool on Base, for all tokens in one call. */
    async topPools(addresses) {
      const { data } = await gecko(
        `${GECKO}/networks/base/tokens/multi/${addresses.join(",")}?include=top_pools`,
        DAY_MS,
      );
      const out = new Map();
      for (const t of data?.data || []) {
        const id = t.relationships?.top_pools?.data?.[0]?.id; // "base_0xpool"
        const pool = id && id.startsWith("base_") ? id.slice(5) : null;
        const addr = String(t.attributes?.address || "").toLowerCase();
        if (pool && /^0x[0-9a-f]{40}$/i.test(pool) && addr) out.set(addr, pool);
      }
      return out;
    },

    /** Daily USD closes and volumes of `token` in `pool`, oldest first. */
    async geckoDaily(pool, token) {
      const r = await gecko(
        `${GECKO}/networks/base/pools/${pool}/ohlcv/day?aggregate=1&limit=100&currency=usd&token=${token}`,
        CANDLE_TTL_MS,
      );
      const rows = (r.data?.data?.attributes?.ohlcv_list || []).slice().reverse(); // newest first -> oldest first
      return toSeries(rows, 4, 5, r.stale);
    },

    /** Daily USD closes and volumes from Coinbase's public candles, oldest first. */
    async coinbaseDaily(product) {
      const r = await cachedGet(`${COINBASE}/products/${product}/candles?granularity=86400`, CANDLE_TTL_MS, {
        headers: { "User-Agent": "bushido-dapp/1.0" },
      });
      const rows = (Array.isArray(r.data) ? r.data : []).slice(0, 100).reverse(); // [time, low, high, open, close, volume]
      return toSeries(rows, 4, 5, r.stale);
    },
  };
}

function toSeries(rows, closeIdx, volIdx, stale) {
  const closes = [];
  const volumes = [];
  for (const row of rows) {
    const c = Number(row?.[closeIdx]);
    if (!Number.isFinite(c) || c <= 0) continue;
    closes.push(c);
    const v = Number(row?.[volIdx]);
    volumes.push(Number.isFinite(v) ? v : 0);
  }
  return { closes, volumes, stale: Boolean(stale) };
}
