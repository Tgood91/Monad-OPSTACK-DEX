// Uniswap Trading API client (server-side).
// The API key lives in the Secure Vault; this module fetches a short-lived
// surrogate from authd over its Unix socket and sends it as x-api-key.
// Sentinel replaces the surrogate with the real key on egress to the
// approved host. The raw key never touches this process's memory.
// Docs: https://developers.uniswap.org/docs/trading/swapping-api

import net from "node:net";

const AUTHD_SOCK = process.env.JARVIS_AUTHD_SOCK || "/run/hatch/auth/authd.sock";
const API = "https://trade-api.gateway.uniswap.org/v1";
const ALLOWED_HOST = "trade-api.gateway.uniswap.org";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Chains the DEX supports that Uniswap classic routing covers.
export const UNISWAP_CHAINS = new Set([1, 10, 8453, 130, 42220, 57073]);

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
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("authd timeout")); }, 8000);
    let raw = "";
    sock.on("connect", () => sock.write(req));
    sock.on("data", (c) => { raw += c.toString("utf8"); });
    sock.on("end", () => {
      clearTimeout(timer);
      const idx = raw.indexOf("\r\n\r\n");
      if (idx < 0) return reject(new Error("authd malformed response"));
      try {
        resolve(JSON.parse(raw.slice(idx + 4)));
      } catch {
        reject(new Error("authd bad JSON"));
      }
    });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function getSurrogate() {
  if (surrogate && Date.now() - surrogateAt < SURROGATE_TTL_MS) return surrogate;
  const j = await authdPost({ name: "custom.uniswap" });
  const entry = (j.credentials || []).find((c) => c.name === "access_token");
  const s = entry?.surrogate;
  if (typeof s !== "string" || !s.startsWith("hsurr:")) {
    throw new Error("no uniswap surrogate from authd");
  }
  surrogate = s;
  surrogateAt = Date.now();
  return s;
}

async function uniFetch(path, body) {
  const surr = await getSurrogate();
  const url = `${API}${path}`;
  if (new URL(url).hostname !== ALLOWED_HOST) throw new Error("host not allowed");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-api-key": surr,
      "x-universal-router-version": "2.0",
      "User-Agent": UA,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surrogate may have expired — drop the cache so the next call refreshes.
    if (res.status === 401 || res.status === 403) { surrogate = null; }
    throw new Error(j.detail || j.errorCode || `uniswap ${res.status}`);
  }
  return j;
}

/**
 * Get an executable quote. Returns normalized amounts + the raw quote
 * object needed for buildSwap().
 */
export async function uniswapQuote({ chainId, tokenIn, tokenOut, amountAtomic, taker, slippageBps }) {
  if (!UNISWAP_CHAINS.has(Number(chainId))) throw new Error("chain not supported by Uniswap");
  const j = await uniFetch("/quote", {
    type: "EXACT_INPUT",
    amount: String(amountAtomic),
    tokenInChainId: Number(chainId),
    tokenOutChainId: Number(chainId),
    tokenIn,
    tokenOut,
    swapper: taker,
    slippageTolerance: slippageBps,
    routingPreference: "BEST_PRICE",
  });
  const q = j.quote;
  if (!q?.output?.amount) throw new Error("no uniswap quote");
  return {
    amountOut: q.output.amount,
    minAmountOut: q.output.minimumAmount || null,
    gasUsd: q.gasFeeUSD ? Number(q.gasFeeUSD) : null,
    routeString: q.routeString || null,
    routing: j.routing || null,
    priceImpact: q.priceImpact ?? null,
    rawQuote: q,
  };
}

/**
 * Turn a raw quote into the executable transaction the user's wallet signs.
 * Server never signs — it only returns {to, data, value}.
 */
export async function uniswapBuildSwap(rawQuote) {
  if (!rawQuote?.quoteId) throw new Error("bad quote");
  const j = await uniFetch("/swap", { quote: rawQuote });
  const t = j.swap;
  if (!t?.to || !t?.data) throw new Error("no swap tx");
  return {
    to: t.to,
    data: t.data,
    value: t.value || "0x0",
    gasLimit: t.gasLimit || null,
  };
}

export function uniswapConfigured() {
  return true; // credential lives in the vault; surrogates fetched on demand
}
