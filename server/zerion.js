// Zerion swap quote proxy (server-side).
// The API key lives in the server env as ZERION_API_KEY (never VITE_-prefixed,
// so it never lands in the frontend bundle). Zerion uses HTTP Basic auth:
//   Authorization: Basic base64(api_key + ":")
// Docs: https://developers.zerion.io/authentication
//
// Why not the vault surrogate: the surrogate/egress pattern does raw string
// substitution, which cannot produce the base64-encoded Basic auth value
// Zerion requires. A server-side env var is the reliable path here.

const API = "https://api.zerion.io";
const ALLOWED_HOST = "api.zerion.io";

// Zerion chain slugs for the DEX's EVM chains. Monad is NOT supported by
// Zerion's swap API (verified 2026-10-07 — every Monad quote 400s).
export const ZERION_CHAINS = {
  1: "ethereum",
  10: "optimism",
  56: "bsc",
  130: "unichain",
  8453: "base",
  42161: "arbitrum",
  42220: "celo",
  43114: "avalanche",
  57073: "ink",
};

function authHeader() {
  const key = process.env.ZERION_API_KEY;
  if (!key) throw new Error("ZERION_API_KEY not set");
  return "Basic " + Buffer.from(key.trim() + ":").toString("base64");
}

async function zerionFetch(path) {
  const url = `${API}${path}`;
  if (new URL(url).hostname !== ALLOWED_HOST) throw new Error("host not allowed");
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: authHeader(),
      "User-Agent": "monad-dex/1.0",
    },
    signal: AbortSignal.timeout(25000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j.errors?.[0]?.detail || j.message || `zerion ${res.status}`;
    throw new Error(String(msg).slice(0, 200));
  }
  return j;
}

/**
 * Get a swap quote. Returns the first quotable route with executable tx data.
 * Params: chainId (number), tokenIn, tokenOut (addresses, ZERO for native),
 *         amountHuman (string), taker (address), slippageBps.
 */
export async function zerionQuote({ chainId, tokenIn, tokenOut, amountHuman, taker, slippageBps }) {
  const zc = ZERION_CHAINS[Number(chainId)];
  if (!zc) throw new Error("chain not supported by Zerion");
  const p = new URLSearchParams({
    "input[chain_id]": zc,
    "input[fungible_id]": tokenIn,
    "input[amount]": String(amountHuman),
    "output[fungible_id]": tokenOut,
    slippage_percent: String((slippageBps ?? 50) / 100),
    currency: "usd",
  });
  // Zerion quotes are wallet-scoped; fall back to zero address for dry quotes.
  const from = taker || "0x0000000000000000000000000000000000000000";
  p.set("from", from);
  p.set("to", from);
  const j = await zerionFetch(`/v1/swap/quotes/?${p.toString()}`);
  const quotes = (j.data || []).map((x) => x.attributes || x);
  const q = quotes.find((a) => {
    const s = a.transaction_swap?.evm || a.transaction_swap;
    return s?.to && s?.data;
  });
  if (!q) throw new Error("no zerion quote");
  const swapTx = q.transaction_swap.evm || q.transaction_swap;
  const ap = q.transaction_approve?.evm || q.transaction_approve;
  return {
    amountOut: String(q.output_amount_after_fees ?? q.output_amount ?? "0"),
    amountOutUsd: parseFloat(q.output_amount_usd ?? 0) || undefined,
    to: swapTx.to,
    data: swapTx.data,
    value: String(swapTx.value || 0),
    spender: q.spender || ap?.to || swapTx.to,
    raw: q,
  };
}

export function zerionSupported(chainId) {
  return !!ZERION_CHAINS[Number(chainId)];
}
