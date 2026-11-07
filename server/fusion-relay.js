// 1inch Fusion relay (server-side).
//
// The browser talks to /api/fusion/* using the official @1inch/fusion-sdk; this
// relay forwards those calls to https://api.1inch.com/fusion and adds the API
// key, so the key never reaches client code. The user's wallet still signs the
// order itself; the server never signs or holds funds.
//
// Only the endpoints Fusion needs are forwarded:
//   quoter  (GET, POST)  price quotes
//   relayer (POST)       submit a signed order
//   orders  (GET)        order status
// on the chains this app supports. Everything else is rejected.

const UPSTREAM = "https://api.1inch.com/fusion";

// Fusion chains this app offers (Base, Optimism, Monad, Unichain).
export const FUSION_CHAINS = new Set([8453, 10, 143, 130]);

const METHODS = { quoter: ["GET", "POST"], relayer: ["POST"], orders: ["GET"] };
const SAFE_PATH = /^\/(quoter|relayer|orders)\/v\d+\.\d+\/(\d+)(\/[A-Za-z0-9._-]+)*\/?$/;

/**
 * Validate a client request and return the upstream path (+ query), or an error.
 * `rest` is everything after "/api/fusion", including the query string.
 */
export function fusionTarget(method, rest) {
  if (typeof rest !== "string" || !rest.startsWith("/")) return { error: "bad path", status: 400 };
  const q = rest.indexOf("?");
  const path = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? "" : rest.slice(q);
  const m = SAFE_PATH.exec(path);
  if (!m || path.includes("..") || path.includes("//")) return { error: "path not allowed", status: 404 };
  const [, service, chain] = m;
  if (!FUSION_CHAINS.has(Number(chain))) return { error: "chain not supported by Fusion", status: 400 };
  if (!METHODS[service].includes(method)) return { error: "method not allowed", status: 405 };
  if (query.length > 2048) return { error: "query too long", status: 414 };
  return { path, query };
}

/**
 * Express handler factory. `getToken()` resolves the 1inch API key (env or vault);
 * `upstream` and `fetchImpl` are injectable for tests.
 */
export function createFusionRelay({ getToken, upstream = UPSTREAM, fetchImpl = fetch } = {}) {
  return async function fusionRelay(req, res) {
    const rest = req.originalUrl.replace(/^\/api\/fusion/, "");
    const t = fusionTarget(req.method, rest);
    if (t.error) return res.status(t.status).json({ error: t.error });

    let token;
    try {
      token = await getToken();
    } catch {
      return res.status(503).json({ error: "ONEINCH_API_KEY not set" });
    }
    if (!token) return res.status(503).json({ error: "ONEINCH_API_KEY not set" });

    try {
      const init = {
        method: req.method,
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(25_000),
      };
      if (req.method === "POST") {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(req.body ?? {});
      }
      const r = await fetchImpl(`${upstream}${t.path}${t.query}`, init);
      const text = await r.text();
      res.status(r.status).type("application/json");
      // Upstream auth problems are our key's problem, not the user's: say so plainly.
      if (r.status === 401 || r.status === 403)
        return res.send(JSON.stringify({ error: `1inch rejected the API key (${r.status})` }));
      return res.send(text);
    } catch (e) {
      return res.status(502).json({ error: String(e.message || e).slice(0, 160) });
    }
  };
}
