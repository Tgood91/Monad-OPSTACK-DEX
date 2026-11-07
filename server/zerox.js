// 0x swap quotes through the server.
//
// 0x v2 requires a "0x-version: v2" request header, but 0x's CORS rules do not
// allow that header from a browser, so a page can never call 0x directly ("Failed
// to fetch"). The server makes the call instead, which also keeps the key out of
// the web page. The key is read from ZEROX_API_KEY, or VITE_0X_API_KEY (the name
// the app used before, still honoured so an existing Render setting keeps working).

const UPSTREAM = "https://api.0x.org/swap/allowance-holder/quote";
const CHAINS = new Set([1, 10, 56, 130, 137, 143, 8453, 42161, 43114, 57073]);
const ADDR = /^0x[0-9a-fA-F]{40}$/;
// 0x rejects very low placeholder addresses as `taker`; used only when no wallet is connected.
export const PLACEHOLDER_TAKER = "0x1111111111111111111111111111111111111bee";

export function zeroxKey(env = process.env) {
  return (env.ZEROX_API_KEY || env.VITE_0X_API_KEY || "").trim();
}

/** Validate query params from the browser; returns the upstream query string or { error, status }. */
export function zeroxParams(q) {
  const chainId = Number(q.chainId);
  if (!CHAINS.has(chainId)) return { error: "chain not supported by 0x", status: 400 };
  if (!ADDR.test(String(q.sellToken)) || !ADDR.test(String(q.buyToken)))
    return { error: "bad token address", status: 400 };
  if (!/^\d{1,40}$/.test(String(q.sellAmount)) || /^0+$/.test(String(q.sellAmount)))
    return { error: "bad sellAmount", status: 400 };
  const taker = ADDR.test(String(q.taker || "")) ? q.taker : PLACEHOLDER_TAKER;
  const p = new URLSearchParams({
    chainId: String(chainId),
    sellToken: q.sellToken,
    buyToken: q.buyToken,
    sellAmount: String(q.sellAmount),
    taker,
  });
  return { query: p.toString() };
}

/** Express handler factory; `getKey` and `fetchImpl` are injectable for tests. */
export function createZeroxProxy({ getKey = zeroxKey, fetchImpl = fetch, upstream = UPSTREAM } = {}) {
  return async function zeroxQuote(req, res) {
    const t = zeroxParams(req.query || {});
    if (t.error) return res.status(t.status).json({ error: t.error });
    const key = getKey();
    if (!key) return res.status(503).json({ error: "ZEROX_API_KEY not set" });
    try {
      const r = await fetchImpl(`${upstream}?${t.query}`, {
        headers: { "0x-api-key": key, "0x-version": "v2", Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await r.text();
      res.status(r.status).type("application/json");
      if (r.status === 401 || r.status === 403)
        return res.send(JSON.stringify({ error: `0x rejected the API key (${r.status})` }));
      return res.send(text);
    } catch (e) {
      return res.status(502).json({ error: String(e.message || e).slice(0, 160) });
    }
  };
}
