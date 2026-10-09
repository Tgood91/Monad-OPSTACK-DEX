// Bushido trading dashboard backend.
// Serves 7-virtue scores (5 on-chain + 2 derived) and Seykota trend signals.
// On-chain source: BushidoVirtueRegistry (Base) — traderVirtues mapping.
// The contract tracks 5 virtues (gi, yu, jin, rei, makoto); meiyo (honor) and
// chugi (loyalty) are derived from trade history patterns.
//
// Virtue -> trading principle mapping (dashboard):
//   gi     Righteousness  Signal Integrity      (execution fidelity)
//   yu     Courage        Risk Discipline       (position conviction)
//   jin    Benevolence    Liquidity Respect     (liquidity depth)
//   rei    Respect        Fee Awareness         (slippage control)
//   makoto Honesty        Transparency          (chain clarity)
//   meiyo  Honor          Performance Integrity (derived: win rate consistency)
//   chugi  Loyalty        Framework Consistency (derived: strategy adherence)

import { ethers } from "ethers";

const REGISTRY_ABI = [
  "function traderVirtues(address) view returns (uint8 gi, uint8 yu, uint8 jin, uint8 rei, uint8 makoto)",
  "function getTraderStats(address) view returns (uint256 totalTrades, uint256 honor, uint8 dominantVirtue)",
  "function virtueController() view returns (address)",
];

// Registry address — set once deployed. Null = use local computed fallback.
const REGISTRY_ADDRESS = process.env.BUSHIDO_REGISTRY || null;
const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";

const VIRTUE_META = [
  { id: "gi", name: "Gi", meaning: "Righteousness", principle: "Signal Integrity", onChain: true },
  { id: "yu", name: "Yu", meaning: "Courage", principle: "Risk Discipline", onChain: true },
  { id: "jin", name: "Jin", meaning: "Benevolence", principle: "Liquidity Respect", onChain: true },
  { id: "rei", name: "Rei", meaning: "Respect", principle: "Fee Awareness", onChain: true },
  { id: "makoto", name: "Makoto", meaning: "Honesty", principle: "Transparency", onChain: true },
  { id: "meiyo", name: "Meiyo", meaning: "Honor", principle: "Performance Integrity", onChain: false },
  { id: "chugi", name: "Chugi", meaning: "Loyalty", principle: "Framework Consistency", onChain: false },
];

/**
 * Get 7-virtue scores for a trader (0-1 scale for dashboard).
 * Falls back to neutral 0.5 when registry is not deployed.
 */
export async function getVirtueScores(trader) {
  const scores = {};
  if (REGISTRY_ADDRESS && ethers.isAddress(trader)) {
    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPC, undefined, { staticNetwork: true });
      const reg = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
      const v = await reg.traderVirtues(trader);
      // On-chain: 0-10 scale -> 0-1
      scores.gi = Number(v.gi) / 10;
      scores.yu = Number(v.yu) / 10;
      scores.jin = Number(v.jin) / 10;
      scores.rei = Number(v.rei) / 10;
      scores.makoto = Number(v.makoto) / 10;
      // Derived: meiyo from honor tier, chugi from trade consistency
      try {
        const stats = await reg.getTraderStats(trader);
        const honor = Number(stats.honor); // 0-100
        scores.meiyo = Math.min(1, honor / 100);
        // chugi: loyalty = consistency; proxy via trade count stability
        const trades = Number(stats.totalTrades);
        scores.chugi = trades > 0 ? Math.min(1, 0.5 + trades / 100) : 0.5;
      } catch {
        scores.meiyo = 0.5;
        scores.chugi = 0.5;
      }
      provider.destroy?.();
      return { scores, source: "on-chain", registry: REGISTRY_ADDRESS };
    } catch (e) {
      // fall through to neutral
    }
  }
  for (const m of VIRTUE_META) scores[m.id] = 0.5;
  return { scores, source: "neutral-fallback", registry: null };
}

export function virtueMeta() {
  return VIRTUE_META;
}

/* ---------------- Seykota trend strategy ---------------- */
// Ed Seykota: trend following via EMA crosses. Signal = fast EMA crosses slow EMA.
// Virtue gating: signals only fire when gi (signal integrity) and yu (risk discipline)
// are above thresholds — no signal without virtue alignment.

const STRATEGIES = [
  {
    id: "seykota",
    name: "Seykota",
    theme: "Ed Seykota — The Trend Follower",
    description: "EMA-cross trend following. Rides sustained moves, cuts losers fast.",
    virtueGate: { gi: 0.6, yu: 0.5 },
    params: { fastEma: 12, slowEma: 26 },
  },
];

export function listStrategies() {
  return STRATEGIES.map((s) => ({ ...s }));
}

function ema(values, period) {
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}

/**
 * Generate a Seykota signal from price history.
 * prices: array of numbers (oldest -> newest). Returns { signal, confidence, detail }.
 */
export function seykotaSignal(prices, virtueScores) {
  if (!Array.isArray(prices) || prices.length < 30) {
    return { signal: "WAIT", confidence: 0, detail: "insufficient price history" };
  }
  const fast = ema(prices, 12);
  const slow = ema(prices, 26);
  const prevFast = ema(prices.slice(0, -1), 12);
  const prevSlow = ema(prices.slice(0, -1), 26);

  const crossedUp = prevFast <= prevSlow && fast > slow;
  const crossedDown = prevFast >= prevSlow && fast < slow;
  const trendUp = fast > slow;

  // Virtue gate
  const gi = virtueScores?.gi ?? 0.5;
  const yu = virtueScores?.yu ?? 0.5;
  if (gi < 0.6 || yu < 0.5) {
    return {
      signal: "WAIT",
      confidence: 0,
      detail: `virtue gate blocked (gi=${gi.toFixed(2)}, yu=${yu.toFixed(2)})`,
      gated: true,
    };
  }

  const separation = Math.abs(fast - slow) / slow; // trend strength
  const confidence = Math.min(0.95, 0.5 + separation * 10);

  if (crossedUp) return { signal: "BUY", confidence, detail: "EMA12 crossed above EMA26", trend: "up" };
  if (crossedDown) return { signal: "SELL", confidence, detail: "EMA12 crossed below EMA26", trend: "down" };
  return {
    signal: trendUp ? "HOLD_LONG" : "HOLD_SHORT",
    confidence: confidence * 0.7,
    detail: trendUp ? "uptrend intact" : "downtrend intact",
    trend: trendUp ? "up" : "down",
  };
}

/**
 * Full dashboard payload: virtues + strategies with live signals.
 * priceFeeds: { [symbol]: number[] } — price history per pair.
 */
export async function dashboardData(trader, priceFeeds = {}) {
  const { scores, source } = await getVirtueScores(trader);
  const strategies = listStrategies().map((s) => {
    // Use first available feed for signal; default WAIT
    const feed = Object.values(priceFeeds)[0];
    const sig = s.id === "seykota" ? seykotaSignal(feed || [], scores) : { signal: "WAIT", confidence: 0 };
    return {
      ...s,
      status: sig.gated ? "gated" : sig.signal === "WAIT" ? "waiting" : "active",
      lastSignal: sig.signal === "WAIT" ? (sig.detail || "Waiting for setup") : `${sig.signal} — ${sig.detail}`,
      confidence: sig.confidence,
    };
  });
  return { virtues: VIRTUE_META.map((m) => ({ ...m, score: scores[m.id] ?? 0.5 })), strategies, source };
}
