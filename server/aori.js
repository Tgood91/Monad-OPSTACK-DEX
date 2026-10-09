// Aori intent-based bridging (keyless quotes).
// Flow: quote -> user signs EIP-712 order -> submit -> maker fills -> poll status.
// Docs: https://docs.aori.io/developers | API: https://api.aori.io
// No API key needed for basic usage. Server never signs or holds funds.

const API = "https://api.aori.io";

// chainKey -> { chainId, contract, eid } (from GET /chains)
let chainCache = null;
let chainCacheAt = 0;
const CHAIN_TTL_MS = 30 * 60 * 1000;

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || body.error || `Aori ${res.status} on ${path}`);
  }
  return body;
}

export async function getChains() {
  if (chainCache && Date.now() - chainCacheAt < CHAIN_TTL_MS) return chainCache;
  const chains = await apiFetch("/chains");
  if (!Array.isArray(chains)) throw new Error("bad chain list");
  chainCache = chains;
  chainCacheAt = Date.now();
  return chains;
}

/** chainKey -> { chainId, contract, eid } */
export async function chainInfo(chainKey) {
  const chains = await getChains();
  return chains.find((c) => c.chainKey === chainKey) || null;
}

let tokenCache = null;
let tokenCacheAt = 0;
const TOKEN_TTL_MS = 5 * 60 * 1000;

export async function getTokenList() {
  if (tokenCache && Date.now() - tokenCacheAt < TOKEN_TTL_MS) return tokenCache;
  const toks = await apiFetch("/tokens");
  if (!Array.isArray(toks)) throw new Error("bad token list");
  tokenCache = toks;
  tokenCacheAt = Date.now();
  return toks;
}

/** Tokens Aori can bridge FROM a chainKey. `token` is 'native' or a 0x address. */
export async function aoriTokens(chainKey) {
  const toks = await getTokenList();
  return toks
    .filter((t) => t.chainKey === chainKey)
    .map((t) => ({
      symbol: t.symbol,
      address: t.address === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ? null : t.address,
      decimals: t.decimals ?? 18,
      chainKey: t.chainKey,
    }));
}

/**
 * Quote an Aori bridge.
 * { fromChainKey, toChainKey, fromToken ('native'|0x…), toToken, amountAtomic, wallet }
 * Returns the order (includes orderHash, outputAmount, startTime, endTime, srcEid, dstEid).
 * The USER's wallet then signs the EIP-712 order and POSTs it to /api/aori/swap.
 */
export async function aoriQuote({ fromChainKey, toChainKey, fromToken, toToken, amountAtomic, wallet }) {
  const [fromToks, toToks] = await Promise.all([aoriTokens(fromChainKey), aoriTokens(toChainKey)]);
  const fi = fromToks.find((t) => (fromToken === "native" ? !t.address : t.address?.toLowerCase() === fromToken.toLowerCase()));
  const ti = toToks.find((t) => (toToken === "native" ? !t.address : t.address?.toLowerCase() === toToken.toLowerCase()));
  if (!fi) throw new Error("from token not supported by Aori");
  if (!ti) throw new Error("to token not supported by Aori");

  const order = await apiFetch("/quote", {
    method: "POST",
    body: JSON.stringify({
      offerer: wallet,
      recipient: wallet,
      inputToken: fi.address || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      outputToken: ti.address || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      inputAmount: String(amountAtomic),
      inputChain: fromChainKey,
      outputChain: toChainKey,
    }),
  });
  if (!order.orderHash) throw new Error("no quote returned");
  return { order, fi, ti };
}

/** EIP-712 typed data for the user to sign. */
export async function aoriSignData(order, chainKey) {
  const ci = await chainInfo(chainKey);
  if (!ci) throw new Error("unknown chain");
  const domain = {
    name: "Aori",
    version: "0.3.1",
    chainId: ci.chainId,
    verifyingContract: ci.address,
  };
  const types = {
    Order: [
      { name: "inputAmount", type: "uint128" },
      { name: "outputAmount", type: "uint128" },
      { name: "inputToken", type: "address" },
      { name: "outputToken", type: "address" },
      { name: "startTime", type: "uint32" },
      { name: "endTime", type: "uint32" },
      { name: "srcEid", type: "uint32" },
      { name: "dstEid", type: "uint32" },
      { name: "offerer", type: "address" },
      { name: "recipient", type: "address" },
    ],
  };
  const message = {
    inputAmount: order.inputAmount,
    outputAmount: order.outputAmount,
    inputToken: order.inputToken,
    outputToken: order.outputToken,
    startTime: order.startTime,
    endTime: order.endTime,
    srcEid: order.srcEid,
    dstEid: order.dstEid,
    offerer: order.offerer,
    recipient: order.recipient,
  };
  return { domain, types, message };
}

/** Submit a signed order. { orderHash, signature } -> swap response. */
export async function aoriSubmit({ orderHash, signature }) {
  return apiFetch("/swap", {
    method: "POST",
    body: JSON.stringify({ orderHash, signature }),
  });
}

/** Poll order status. */
export async function aoriStatus(orderHash) {
  return apiFetch(`/data/status?orderHash=${orderHash}`);
}
