// Pre-trade gate rules for the Bushido swap panel (pure, unit-tested).
export const SLIPPAGE_MIN_PCT = 0.1;
export const SLIPPAGE_MAX_PCT = 1;

/** Parse a slippage percent string; returns { ok, bps, reason }. */
export function checkSlippage(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return { ok: false, reason: 'Enter slippage as a number' };
  if (n < SLIPPAGE_MIN_PCT || n > SLIPPAGE_MAX_PCT)
    return { ok: false, reason: `Slippage must be ${SLIPPAGE_MIN_PCT}%–${SLIPPAGE_MAX_PCT}%` };
  return { ok: true, bps: Math.round(n * 100) };
}

/** Gate decision: both slippage and the dry-run simulation must pass. */
export function gateTrade({ slippagePct, sim }) {
  const s = checkSlippage(slippagePct);
  if (!s.ok) return { allowed: false, reason: s.reason };
  if (!sim?.ok) return { allowed: false, reason: 'Simulation failed: ' + (sim?.reason || 'not run') };
  return { allowed: true, bps: s.bps };
}

/** Report an error to the Operations log (never throws). */
export function reportOps(severity, source, message) {
  try {
    fetch('/api/ops/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ severity, source, message: String(message).slice(0, 300) }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
