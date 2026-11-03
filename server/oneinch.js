// 1inch swap API proxy (server-side).
// The API key lives in the Secure Vault as custom.1inch; this module fetches a
// short-lived surrogate from authd over its Unix socket and sends it as
// Authorization: Bearer. Egress swaps the surrogate for the real key.
// The raw key never touches this process's memory.
// Docs: https://docs.1inch.dev/

import net from "node:net";

const AUTHD_SOCK = process.env.JARVIS_AUTHD_SOCK || "/run/hatch/auth/authd.sock";
const API = "https://api.1inch.dev";
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

async function inchFetch(path) {
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
    throw new Error(j.description || j.error || `1inch ${res.status}`);
  }
  return j;
}

/**
 * Get a quote. Returns { amountOut, raw }.
 */
export async function oneinchQuote({ chainId, src, dst, amountAtomic }) {
  const j = await inchFetch(
    `/swap/v6.0/${chainId}/quote?src=${src}&dst=${dst}&amount=${amountAtomic}`
  );
  if (!j.dstAmount) throw new Error("no 1inch quote");
  return { amountOut: j.dstAmount, raw: j };
}

/**
 * Build an executable swap tx. Returns { to, data, value }.
 */
export async function oneinchSwap({ chainId, src, dst, amountAtomic, from, slippageBps }) {
  const j = await inchFetch(
    `/swap/v6.0/${chainId}/swap?src=${src}&dst=${dst}&amount=${amountAtomic}` +
    `&from=${from}&slippage=${(slippageBps ?? 50) / 100}&disableEstimate=true`
  );
  if (!j.tx?.data) throw new Error("no 1inch swap tx");
  return { to: j.tx.to, data: j.tx.data, value: String(j.tx.value || 0) };
}
