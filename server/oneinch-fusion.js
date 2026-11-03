// 1inch Fusion+ cross-chain quote proxy (server-side).
// Same Secure Vault credential as the 1inch swap API (custom.1inch): this
// module fetches a short-lived surrogate from authd over its Unix socket and
// sends it as Authorization: Bearer. Egress swaps the surrogate for the real
// key. The raw key never touches this process's memory.
// Endpoint shape verified against @1inch/cross-chain-sdk v2.2.4 and probed
// live: GET {url}/quoter/v1.2/quote/receive/?<params> (Bearer auth).
// QUOTES ONLY — order build/submit is not wired (see bottom note).

import net from "node:net";

const AUTHD_SOCK = process.env.JARVIS_AUTHD_SOCK || "/run/hatch/auth/authd.sock";
const API = "https://api.1inch.dev/fusion-plus";
const ALLOWED_HOST = "api.1inch.dev";

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
  const j = await authdPost({ name: "custom.1inch" });
  const entry = (j.credentials || []).find((c) => c.name === "access_token");
  const s = entry?.surrogate;
  if (typeof s !== "string" || !s.startsWith("hsurr:")) {
    throw new Error("no 1inch surrogate from authd");
  }
  surrogate = s;
  surrogateAt = Date.now();
  return s;
}

async function fusionFetch(path) {
  const surr = await getSurrogate();
  const url = `${API}${path}`;
  if (new URL(url).hostname !== ALLOWED_HOST) throw new Error("host not allowed");
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${surr}`,
      "User-Agent": "monad-dex/1.0",
    },
    signal: AbortSignal.timeout(25000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) surrogate = null;
    throw new Error(j.description || j.error || j.message || `1inch Fusion+ ${res.status}`);
  }
  return j;
}

const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || ""));

/**
 * Cross-chain quote (read-only). Returns normalized quote:
 * { quoteId, dstTokenAmount, recommendedPreset, presets, raw }
 */
export async function fusionQuote({ srcChainId, dstChainId, srcToken, dstToken, amountAtomic, wallet }) {
  srcChainId = Number(srcChainId);
  dstChainId = Number(dstChainId);
  if (!Number.isInteger(srcChainId) || !Number.isInteger(dstChainId)) throw new Error("bad chain ids");
  if (srcChainId === dstChainId) throw new Error("src/dst chains must differ");
  if (!isAddr(srcToken)) throw new Error("bad srcToken");
  if (!isAddr(dstToken)) throw new Error("bad dstToken");
  if (!/^\d{1,40}$/.test(String(amountAtomic))) throw new Error("bad amountAtomic");
  if (!isAddr(wallet)) throw new Error("bad wallet");

  const qs = new URLSearchParams({
    srcChain: String(srcChainId),
    dstChain: String(dstChainId),
    srcTokenAddress: srcToken,
    dstTokenAddress: dstToken,
    amount: String(amountAtomic),
    walletAddress: wallet,
    enableEstimate: "true",
  });
  const j = await fusionFetch(`/quoter/v1.2/quote/receive?${qs.toString()}`);
  if (!j.quoteId || !j.dstTokenAmount) throw new Error("no Fusion+ quote returned");
  return {
    quoteId: j.quoteId,
    dstTokenAmount: String(j.dstTokenAmount),
    recommendedPreset: j.recommendedPreset || null,
    presets: j.presets || null,
    timeLocks: j.timeLocks || null,
    prices: j.prices || null,
    raw: j,
  };
}

// NOTE: execution (order build -> EIP-712 sign -> submit -> secret reveal ->
// status poll) is intentionally not wired yet. When it is, it needs:
//  POST /v1.2/{srcChainId}/order/build, POST /v1.2/{srcChainId}/order/submit,
//  GET  /v1.2/{srcChainId}/order/status/{orderHash}, plus client-side secret
// generation (see @1inch/cross-chain-sdk HashLock). The USER's wallet signs
// the order; the server never signs or holds funds.
