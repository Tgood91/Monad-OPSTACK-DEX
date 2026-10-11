// NEAR Intents 1Click API client.
// Flow: tokens → quote(dry) → quote(wet) → user deposits → deposit/submit → status poll.
// Auth: API key from Secure Vault (custom.near-intents) sent as Bearer via
// authd surrogate — drops swaps from 25bps to 20bps (1bp on USDC/USDT/DAI
// pairs) and enables appFees. Falls back to keyless if the vault is empty.
// Docs: https://github.com/near/agent-skills/blob/HEAD/skills/near-intents/SKILL.md

import net from "node:net";

const API = "https://1click.chaindefuser.com";
const AUTHD_SOCK = process.env.JARVIS_AUTHD_SOCK || "/run/hatch/auth/authd.sock";

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

// --- vault surrogate (best-effort; keyless fallback if unavailable) ---
let surrogate = null;
let surrogateAt = 0;
const SURROGATE_TTL_MS = 5 * 60 * 1000;

function authdPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req =
      `POST /v1/credentials/surrogate HTTP/1.1\r\n` +
      `Host: authd.local\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n\r\n` +
      body;
    const sock = net.createConnection(AUTHD_SOCK);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("authd timeout")); }, 5000);
    let raw = "";
    sock.on("connect", () => sock.write(req));
    sock.on("data", (c) => { raw += c.toString("utf8"); });
    sock.on("end", () => {
      clearTimeout(timer);
      const idx = raw.indexOf("\r\n\r\n");
      if (idx < 0) return reject(new Error("authd malformed"));
      try { resolve(JSON.parse(raw.slice(idx + 4))); }
      catch { reject(new Error("authd bad JSON")); }
    });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function getAuthHeader() {
  try {
    if (surrogate && Date.now() - surrogateAt < SURROGATE_TTL_MS) {
      return { Authorization: `Bearer ${surrogate}` };
    }
    const j = await authdPost({ name: "custom.near-intents" });
    const entry = (j.credentials || []).find((c) => c.name === "access_token");
    const s = entry?.surrogate;
    if (typeof s === "string" && s.startsWith("hsurr:")) {
      surrogate = s;
      surrogateAt = Date.now();
      return { Authorization: `Bearer ${s}` };
    }
  } catch {
    // fall through to keyless
  }
  return {};
}

async function apiFetch(path, opts = {}) {
  const auth = await getAuthHeader();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...auth, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) surrogate = null;
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

function quoteBody({ originAsset, destinationAsset, amount, refundTo, recipient, slippageBps, dry, appFees }) {
  const body = {
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
  // Optional fee collection: [{ recipient: "0x…", fee: 50 }] (bps, integer).
  // With API key: 50/50 split with 1Click (their half min 20bps). Without: your fee + 25bps.
  if (Array.isArray(appFees) && appFees.length) body.appFees = appFees;
  return body;
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
