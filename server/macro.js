// Market regime feed: Coinbase daily prices of five markets, blended with the Seykota trend.
//
// Replaces the old Yahoo Finance macro factors (rates, dollar, credit, BTC, ETH). Yahoo refuses requests from
// Render's servers, so on the live site every factor was unavailable and every Agent job failed with
// "ETH price feed unavailable". Coinbase's public candles do work from Render (the Bushido tab already uses them).
//
// Factors: daily USD closes of five markets traded on Base, from the majors out to the riskiest: ETH, BTC, AERO
// (Base DeFi), VIRTUAL (AI agents), DEGEN (memes). All five are listed on Coinbase, which is the primary source.
// If Coinbase cannot be read for a market, its most liquid Base pool on GeckoTerminal (CoinGecko's on-chain data)
// is the backup; that pool lookup only runs when a backup is needed.
// Each market votes +1 when its close is above its 26-day EMA and -1 below. Sum >= +3 is RISK-ON, <= -3 RISK-OFF,
// else NEUTRAL. With fewer than 3 of the 5 markets readable the regime is UNAVAILABLE, never guessed from a partial
// count. Coin addresses for the backup come from the verified Base list (src/dex/chains.js); server/market-data.js
// handles caching, retries and GeckoTerminal's rate limit. The computed market is kept 5 minutes.

import { seykotaSignal, getVirtueScores, virtueMeta } from "./bushido.js";
import { createMarketData } from "./market-data.js";
import { CHAINS } from "../src/dex/chains.js";

export const MARKETS = [
  { id: "eth", symbol: "ETH", label: "Ethereum (ETH)", coinbase: "ETH-USD" },
  { id: "btc", symbol: "cbBTC", label: "Bitcoin (cbBTC)", coinbase: "BTC-USD" },
  { id: "aero", symbol: "AERO", label: "Aerodrome (AERO) · Base DeFi", coinbase: "AERO-USD" },
  { id: "virtual", symbol: "VIRTUAL", label: "Virtuals (VIRTUAL) · AI agents", coinbase: "VIRTUAL-USD" },
  { id: "degen", symbol: "DEGEN", label: "Degen (DEGEN) · memes", coinbase: "DEGEN-USD" },
];
export const MIN_MARKETS = 3;
const MARKET_TTL_MS = 5 * 60_000;

function ema(values, period) {
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}

const tokenAddress = (symbol) => CHAINS.base.tokens.find((t) => t.symbol === symbol)?.address || null;

/** One market's row: trend vs EMA26, its vote, the Seykota signal (gate bypassed) and a liquidity proxy. */
export function computeFactor(m, series, source, extra = {}) {
  const { closes, volumes } = series;
  // Jin (liquidity proxy): recent volume vs the period average, capped [0, 1].
  let volumeRatio = null;
  if (volumes.length >= 5) {
    const recent = volumes.slice(-5).reduce((a, v) => a + v, 0) / 5;
    const avg = volumes.reduce((a, v) => a + v, 0) / volumes.length;
    volumeRatio = avg > 0 ? Math.min(1, recent / avg) : null;
  }
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const above = last > e26;
  const sig =
    closes.length >= 30 ? seykotaSignal(closes, { gi: 1, yu: 1 }) : { signal: "WAIT", detail: "insufficient history" };
  return {
    id: m.id,
    label: m.label,
    symbol: m.symbol,
    source,
    available: true,
    stale: Boolean(series.stale),
    last,
    change1dPct: ((last - prev) / prev) * 100,
    ema12: e12,
    ema26: e26,
    trend: above ? "above EMA26" : "below EMA26",
    vote: above ? 1 : -1,
    seykota: sig.signal,
    seykotaDetail: sig.detail,
    volumeRatio,
    ...extra,
  };
}

export function regimeOf(factors) {
  const avail = factors.filter((f) => f.available);
  const score = avail.reduce((s, f) => s + f.vote, 0);
  const regime =
    avail.length < MIN_MARKETS ? "UNAVAILABLE" : score >= 3 ? "RISK-ON" : score <= -3 ? "RISK-OFF" : "NEUTRAL";
  return { regime, regimeScore: score, marketsAvailable: avail.length, marketsTotal: factors.length };
}

export function blend(trend, regime, gate) {
  if (gate === "closed") return "WAIT (virtue gate)";
  if (gate === "unknown") return `${trend} (gate unknown — connect wallet)`;
  const longish = trend === "BUY" || trend === "HOLD_LONG";
  const shortish = trend === "SELL" || trend === "HOLD_SHORT";
  if (regime === "UNAVAILABLE") {
    if (longish) return "LONG (regime unavailable)";
    if (shortish) return "SHORT (regime unavailable)";
    return "WAIT";
  }
  if (longish && regime === "RISK-ON") return "CONFIRMED LONG";
  if (longish && regime === "NEUTRAL") return "LONG (unconfirmed)";
  if (longish && regime === "RISK-OFF") return "CONFLICT — trend vs regime";
  if (shortish && regime === "RISK-OFF") return "CONFIRMED SHORT";
  if (shortish && regime === "NEUTRAL") return "SHORT (unconfirmed)";
  if (shortish && regime === "RISK-ON") return "CONFLICT — trend vs regime";
  return "WAIT";
}

// Virtue tag for one blended signal — the signal's single dominant virtue.
//
// Mirrors the registry's _getDominantVirtue: highest score wins, ties break
// toward the earliest virtue (Gi > Yu > Jin). Scores come from the signal's
// own measurable properties:
//   Gi  (Signal Integrity):  EMA trend clarity — |EMA12 − EMA26| / EMA26.
//   Yu  (Risk Discipline):   trend × regime agreement (1 agree, 0.5 neutral/unknown/WAIT, 0 conflict).
//   Jin (Liquidity Respect): recent volume vs the period average (liquidity proxy).
// Rei (slippage) and Makoto (chain clarity) are execution-time virtues —
// they apply when a trade is recorded, not at signal level, so they are
// not scored here.
const VIRTUE_BY_ID = Object.fromEntries(virtueMeta().map((m) => [m.id, m]));

function virtueFor(f, trend, regime) {
  const sep = f.ema12 != null && f.ema26 != null && f.ema26 !== 0 ? Math.abs(f.ema12 - f.ema26) / f.ema26 : 0;
  const gi = Math.min(1, sep * 20);
  let yu;
  if (trend === "WAIT") yu = 0.5;
  else if (regime === "NEUTRAL" || regime === "UNAVAILABLE") yu = 0.5;
  else if ((trend === "BUY" || trend === "HOLD_LONG") && regime === "RISK-ON") yu = 1;
  else if ((trend === "SELL" || trend === "HOLD_SHORT") && regime === "RISK-OFF") yu = 1;
  else yu = 0;
  const jin = f.volumeRatio;
  const scored = [
    { id: "gi", score: gi },
    { id: "yu", score: yu },
    ...(jin == null ? [] : [{ id: "jin", score: jin }]),
  ];
  let dom = scored[0];
  for (const s of scored.slice(1)) if (s.score > dom.score) dom = s;
  const meta = VIRTUE_BY_ID[dom.id];
  return {
    scores: { gi, yu, jin },
    virtue: { id: dom.id, name: meta.name, meaning: meta.meaning, principle: meta.principle, score: dom.score },
  };
}

/** The feed. `data` and `now` are injectable for tests. */
export function createMacro({ data = createMarketData(), now = Date.now, virtueScores = getVirtueScores } = {}) {
  let cache = { at: 0, market: null };

  async function getMarket() {
    if (cache.market && now() - cache.at < MARKET_TTL_MS) return { ...cache.market, cached: true };
    const markets = MARKETS.map((m) => ({ ...m, address: tokenAddress(m.symbol) }));
    // GeckoTerminal pools are only looked up if some market needs the backup (one call for all of them).
    let pools = null;
    const poolFor = async (m) => {
      if (!m.address) return null;
      if (pools === null) {
        try {
          pools = await data.topPools(markets.filter((x) => x.address).map((x) => x.address));
        } catch {
          pools = new Map();
        }
      }
      return pools.get(m.address.toLowerCase()) || null;
    };
    const factors = [];
    for (const m of markets) {
      let series = null;
      let source = null;
      let pool = null;
      try {
        const s = await data.coinbaseDaily(m.coinbase);
        if (s.closes.length >= 30) [series, source] = [s, "Coinbase"];
      } catch {
        /* try the backup */
      }
      if (!series) {
        pool = await poolFor(m);
        if (pool) {
          try {
            const s = await data.geckoDaily(pool, m.address);
            if (s.closes.length >= 2) [series, source] = [s, "GeckoTerminal"];
          } catch {
            /* unavailable */
          }
        }
      }
      factors.push(
        series
          ? computeFactor(m, series, source, { pool: source === "GeckoTerminal" ? pool : null })
          : { id: m.id, label: m.label, symbol: m.symbol, source: null, available: false, vote: 0, volumeRatio: null },
      );
    }
    const market = { factors, ...regimeOf(factors), updatedAt: new Date(now()).toISOString() };
    cache = { at: now(), market };
    return { ...market, cached: false };
  }

  async function macroFeed(trader) {
    const market = await getMarket();
    let virtueGate = { status: "unknown", gi: null, yu: null };
    if (trader && /^0x[0-9a-fA-F]{40}$/.test(trader)) {
      try {
        const { scores } = await virtueScores(trader);
        const gi = scores.gi ?? null;
        const yu = scores.yu ?? null;
        // No registry scores -> the gate stays "unknown" (never decided by an invented number).
        if (gi != null && yu != null) virtueGate = { status: gi >= 0.6 && yu >= 0.5 ? "open" : "closed", gi, yu };
      } catch {
        /* gate stays unknown */
      }
    }
    const signals = market.factors
      .filter((f) => f.available)
      .map((f) => {
        const { scores, virtue } = virtueFor(f, f.seykota, market.regime);
        return {
          id: f.id,
          label: f.label,
          trend: f.seykota,
          regime: market.regime,
          virtueGate: virtueGate.status,
          blended: blend(f.seykota, market.regime, virtueGate.status),
          virtueScores: scores,
          virtue,
        };
      });
    return {
      ...market,
      signals,
      virtueGate,
      notes: [
        `Regime = sum of the votes of ${MARKETS.length} Base markets vs their 26-day EMA (≥ +3 RISK-ON, ≤ −3 RISK-OFF); fewer than ${MIN_MARKETS} readable = UNAVAILABLE.`,
        "Prices: Coinbase daily candles; a market Coinbase cannot answer falls back to its most liquid Base pool on GeckoTerminal.",
        "Seykota trend computed with the virtue gate bypassed; the gate is applied separately in the blended verdict.",
        "Each blended signal carries its single dominant virtue (registry tie-break: highest score wins, ties → earliest Gi > Yu > Jin). Rei/Makoto are execution-time virtues and are not scored at signal level.",
      ],
    };
  }

  return { getMarket, macroFeed };
}

// The server's shared instance.
export const { getMarket, macroFeed } = createMacro();
