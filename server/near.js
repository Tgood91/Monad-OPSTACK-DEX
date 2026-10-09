// NEAR Intents 1Click API client (keyless).
// Flow: tokens → quote(dry) → quote(wet) → user deposits → deposit/submit → status poll.
// Docs: https://github.com/near/agent-skills/blob/HEAD/skills/near-intents/SKILL.md

const API = "https://1click.chaindefuser.com";

// DEX chainId -> NEAR blockchain name (only chains present in /v0/tokens)
export const NEAR_CHAINS = {
  8453: "base",
  1: "eth",
  10: "op",
  143: "monad",
};

let tokenCache = null;
let tokenCacheAt = 0;
const TOKEN_TTL_MS = 5 * 60 * 1000;

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || `1Click ${res.status} on ${path}`);
  }
  return body;
}

export async function getTokenList() {
  if (tokenCache && Date.now() - tokenCacheAt < TOKEN_TTL_MS) return tokenCache;
  const toks = await apiFetch("/v0/tokens");
  if (!Array.isArray(toks)) throw new Error("bad token list");
  tokenCache = toks;
  tokenCacheAt = Date.now();
  return toks;
}

/** Tokens available for bridging on a chain. `token` is 'native' or a 0x address. */
export async function bridgeTokens(chainId) {
  const bc = NEAR_CHAINS[Number(chainId)];
  if (!bc) return [];
  const toks = await getTokenList();
  return toks
    .filter((t) => t.blockchain === bc)
    .map((t) => ({
      symbol: t.symbol,
      assetId: t.assetId,
      decimals: t.decimals,
      address: t.contractAddress || null, // null = native
      price: t.price ?? null,
    }))
    .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
}

/** Resolve (chainId, tokenAddress|'native') -> 1Click assetId. */
export async function resolveAsset(chainId, token) {
  const bc = NEAR_CHAINS[Number(chainId)];
  if (!bc) throw new Error(`NEAR Intents: chain ${chainId} not supported`);
  const toks = await getTokenList();
  const want = String(token).toLowerCase();
  const hit = toks.find((t) => {
    if (t.blockchain !== bc) return false;
    const ca = (t.contractAddress || "native").toLowerCase();
    return ca === want;
  });
  if (!hit) throw new Error(`NEAR Intents: token not listed for chain ${chainId}`);
  return hit;
}

function quoteBody({ originAsset, destinationAsset, amount, refundTo, recipient, slippageBps, dry }) {
  return {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: slippageBps,
    originAsset,
    destinationAsset,
    amount: String(amount),
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    depositType: "ORIGIN_CHAIN",
  };
}

/** Dry quote — preview only, no deposit address. */
export async function dryQuote(params) {
  const j = await apiFetch("/v0/quote", {
    method: "POST",
    body: JSON.stringify(quoteBody({ ...params, dry: true })),
  });
  return normalizeQuote(j);
}

/** Wet quote — returns a deposit address (valid ~10 min). */
export async function wetQuote(params) {
  const j = await apiFetch("/v0/quote", {
    method: "POST",
    body: JSON.stringify(quoteBody({ ...params, dry: false })),
  });
  const q = normalizeQuote(j);
  q.depositAddress = j.quote?.depositAddress || null;
  q.quoteSignature = j.signature || null;
  return q;
}

function normalizeQuote(j) {
  const q = j.quote;
  if (!q?.amountOut) throw new Error("no quote returned");
  return {
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountInUsd: q.amountInUsd,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    amountOutUsd: q.amountOutUsd,
    minAmountOut: q.minAmountOut,
    timeEstimateSec: q.timeEstimate ?? null,
    depositAddress: null,
    raw: q,
  };
}

/** Notify 1Click of the deposit tx (optional, speeds up processing). */
export async function submitDeposit({ depositAddress, txHash }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("bad txHash");
  if (!/^0x[0-9a-fA-F]{40}$/.test(depositAddress)) throw new Error("bad depositAddress");
  return apiFetch("/v0/deposit/submit", {
    method: "POST",
    body: JSON.stringify({ txHash, depositAddress }),
  });
}

const TERMINAL = new Set(["SUCCESS", "FAILED", "REFUNDED", "INCOMPLETE_DEPOSIT"]);

/** Poll status for a deposit address. */
export async function getStatus(depositAddress) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(depositAddress)) throw new Error("bad depositAddress");
  const j = await apiFetch(`/v0/status?depositAddress=${depositAddress}`);
  return {
    status: j.status || "UNKNOWN",
    terminal: TERMINAL.has(j.status),
    details: j,
  };
}
