// Standalone live macro feed — Druckenmiller factors blended with Seykota.
//
// Keyless sources only: Yahoo Finance chart API (rates, dollar, credit,
// crypto). FRED CSV was tested and times out from this environment, so the
// Fed balance sheet (WALCL) is NOT fetched — liquidity is proxied by BTC +
// dollar + rates. If a FRED key is ever added, WALCL becomes the direct
// liquidity series. No API keys. In-memory 60s cache. One factor failing
// never kills the feed (that factor is marked unavailable).

import { seykotaSignal, getVirtueScores, virtueMeta } from "./bushido.js";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const CACHE_TTL_MS = 60_000;

// Factors: `invert` = above-EMA26 is risk-OFF (yields, dollar).
// Otherwise above-EMA26 is risk-ON.
const FACTORS = [
  { id: "us10y", label: "US 10Y Yield", symbol: "^TNX", invert: true },
  { id: "us13w", label: "US 13W Bill", symbol: "^IRX", invert: true },
  { id: "dxy", label: "US Dollar Index", symbol: "DX-Y.NYB", invert: true },
  { id: "hyg", label: "High-Yield Credit (HYG)", symbol: "HYG", invert: false },
  { id: "hyg_lqd", label: "Credit Appetite (HYG/LQD)", ratio: ["HYG", "LQD"], invert: false },
  { id: "btc", label: "Bitcoin", symbol: "BTC-USD", invert: false },
  { id: "eth", label: "Ethereum", symbol: "ETH-USD", invert: false },
];

// Risk assets get a blended Seykota × macro verdict. Yields/dollar/ratio
// feed the regime only — they are not trade signals.
const BLEND_IDS = ["btc", "eth", "hyg"];

function ema(values, period) {
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}

async function fetchSeries(symbol) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`,
      { headers: { "User-Agent": UA }, signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const j = await res.json();
    const q = j?.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!q || !Array.isArray(q.close)) return null;
    const closes = q.close.filter((c) => typeof c === "number" && Number.isFinite(c));
    const volumes = Array.isArray(q.volume)
      ? q.volume.filter((v) => typeof v === "number" && Number.isFinite(v))
      : [];
    return closes.length ? { closes, volumes } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

let cache = { at: 0, market: null };

async function getMarket() {
  if (cache.market && Date.now() - cache.at < CACHE_TTL_MS) return { ...cache.market, cached: true };
  const symbols = [...new Set(FACTORS.flatMap((f) => f.ratio || [f.symbol]))];
  const results = await Promise.allSettled(symbols.map((s) => fetchSeries(s)));
  const bySymbol = {};
  symbols.forEach((s, i) => {
    bySymbol[s] = results[i].status === "fulfilled" ? results[i].value : null;
  });

  const factors = [];
  for (const f of FACTORS) {
    let closes = null;
    let volumes = [];
    if (f.ratio) {
      const [a, b] = f.ratio.map((s) => bySymbol[s]);
      if (a && b) {
        const n = Math.min(a.closes.length, b.closes.length);
        closes = a.closes.slice(-n).map((v, i) => v / b.closes[b.closes.length - n + i]);
        volumes = a.volumes; // ratio factor: use the numerator asset's volume
      }
    } else {
      const s = bySymbol[f.symbol];
      closes = s?.closes ?? null;
      volumes = s?.volumes ?? [];
    }
    if (!closes || closes.length < 2) {
      factors.push({ id: f.id, label: f.label, symbol: f.symbol || f.ratio.join("/"), source: "Yahoo Finance", available: false, vote: 0, volumeRatio: null });
      continue;
    }
    // Jin (liquidity proxy): recent volume vs 3mo average, capped [0, 1].
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
    const vote = f.invert ? (above ? -1 : 1) : (above ? 1 : -1);
    // Pure trend signal: virtue gate bypassed on purpose — the gate is
    // applied separately in the blended verdict below.
    const sig = closes.length >= 30
      ? seykotaSignal(closes, { gi: 1, yu: 1 })
      : { signal: "WAIT", detail: "insufficient history" };
    factors.push({
      id: f.id,
      label: f.label,
      symbol: f.symbol || f.ratio.join("/"),
      source: "Yahoo Finance",
      available: true,
      last,
      change1dPct: ((last - prev) / prev) * 100,
      ema12: e12,
      ema26: e26,
      trend: above ? "above EMA26" : "below EMA26",
      vote,
      seykota: sig.signal,
      seykotaDetail: sig.detail,
      volumeRatio,
    });
  }

  const score = factors.reduce((s, f) => s + (f.vote || 0), 0);
  const regime = score >= 3 ? "RISK-ON" : score <= -3 ? "RISK-OFF" : "NEUTRAL";
  const market = { factors, regime, regimeScore: score, updatedAt: new Date().toISOString() };
  cache = { at: Date.now(), market };
  return { ...market, cached: false };
}

function blend(trend, regime, gate) {
  if (gate === "closed") return "WAIT (virtue gate)";
  if (gate === "unknown") return `${trend} (gate unknown — connect wallet)`;
  const longish = trend === "BUY" || trend === "HOLD_LONG";
  const shortish = trend === "SELL" || trend === "HOLD_SHORT";
  if (longish && regime === "RISK-ON") return "CONFIRMED LONG";
  if (longish && regime === "NEUTRAL") return "LONG (unconfirmed)";
  if (longish && regime === "RISK-OFF") return "CONFLICT — trend vs macro";
  if (shortish && regime === "RISK-OFF") return "CONFIRMED SHORT";
  if (shortish && regime === "NEUTRAL") return "SHORT (unconfirmed)";
  if (shortish && regime === "RISK-ON") return "CONFLICT — trend vs macro";
  return "WAIT";
}

// Virtue tag for one blended signal — the signal's single dominant virtue.
//
// Mirrors the registry's _getDominantVirtue: highest score wins, ties break
// toward the earliest virtue (Gi > Yu > Jin). Scores come from the signal's
// own measurable properties:
//   Gi  (Signal Integrity):  EMA trend clarity — |EMA12 − EMA26| / EMA26.
//   Yu  (Risk Discipline):   trend × regime agreement (1 agree, 0.5 neutral/WAIT, 0 conflict).
//   Jin (Liquidity Respect): recent volume vs 3mo average (liquidity proxy).
// Rei (slippage) and Makoto (chain clarity) are execution-time virtues —
// they apply when a trade is recorded, not at signal level, so they are
// not scored here.
const VIRTUE_BY_ID = Object.fromEntries(virtueMeta().map((m) => [m.id, m]));

function virtueFor(f, trend, regime) {
  const sep = f.ema12 != null && f.ema26 != null && f.ema26 !== 0
    ? Math.abs(f.ema12 - f.ema26) / f.ema26
    : 0;
  const gi = Math.min(1, sep * 20);
  let yu;
  if (trend === "WAIT") yu = 0.5;
  else if (regime === "NEUTRAL") yu = 0.5;
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

export async function macroFeed(trader) {
  const market = await getMarket();
  let virtueGate = { status: "unknown", gi: null, yu: null };
  if (trader && /^0x[0-9a-fA-F]{40}$/.test(trader)) {
    try {
      const { scores } = await getVirtueScores(trader);
      const gi = scores.gi ?? 0.5;
      const yu = scores.yu ?? 0.5;
      virtueGate = { status: gi >= 0.6 && yu >= 0.5 ? "open" : "closed", gi, yu };
    } catch { /* gate stays unknown */ }
  }
  const signals = market.factors
    .filter((f) => BLEND_IDS.includes(f.id) && f.available)
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
      "Regime = sum of 7 factor votes vs EMA26 (≥ +3 RISK-ON, ≤ −3 RISK-OFF).",
      "Seykota trend computed with the virtue gate bypassed; the gate is applied separately in the blended verdict.",
      "Each blended signal carries its single dominant virtue (registry tie-break: highest score wins, ties → earliest Gi > Yu > Jin). Rei/Makoto are execution-time virtues and are not scored at signal level.",
      "FRED WALCL (Fed balance sheet) not fetched — unreachable from this server. Liquidity proxied by BTC + dollar + rates.",
    ],
  };
}
