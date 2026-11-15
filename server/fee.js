// Bushido integrator / referral fee — server copy.
//
// Every server-proxied DEX source that supports an integrator fee (0x,
// 1inch) pays it to ONE wallet: Tanner's. Override with the FEE_RECIPIENT
// and FEE_BPS server env vars; the defaults below are used when they are
// unset. FEE_BPS is in basis points: 25 = 0.25%. Set FEE_BPS=0 to disable.
//
// The bps is capped at 300 (3%): that is the strictest source cap (1inch
// rejects a partner fee above 3%), so one number stays valid everywhere.
// The frontend sources (Velora, KyberSwap) use src/dex/fee.js instead —
// keep the two defaults in sync.

const ADDR = /^0x[0-9a-fA-F]{40}$/;
export const DEFAULT_FEE_RECIPIENT = "0xBA397fAae1D5Fe10C0356f2e585bef34577ab111";
export const DEFAULT_FEE_BPS = 25;
export const MAX_FEE_BPS = 300;

export function feeConfig(env = process.env) {
  const recipient = ADDR.test(String(env.FEE_RECIPIENT || ""))
    ? String(env.FEE_RECIPIENT)
    : DEFAULT_FEE_RECIPIENT;
  let bps = Number(env.FEE_BPS ?? DEFAULT_FEE_BPS);
  if (!Number.isFinite(bps) || bps < 0) bps = 0;
  if (bps > MAX_FEE_BPS) bps = MAX_FEE_BPS;
  return { recipient, bps, pct: bps / 100, enabled: bps > 0 };
}

/** 0x Swap API v2 fee params: fee is taken in the buy token. */
export function zeroxFeeParams(buyToken, env = process.env) {
  const f = feeConfig(env);
  if (!f.enabled) return {};
  return {
    swapFeeRecipient: f.recipient,
    swapFeeBps: String(f.bps),
    swapFeeToken: buyToken,
  };
}

/**
 * 1inch Swap API v6 fee query fragment. `fee` is a PERCENT (0.25 = 0.25%),
 * max 3, and it MUST be identical on the /quote and /swap calls.
 * Returns "" when the fee is disabled.
 */
export function oneinchFeeQuery(env = process.env) {
  const f = feeConfig(env);
  if (!f.enabled) return "";
  return `&fee=${f.pct}&referrer=${f.recipient}`;
}
