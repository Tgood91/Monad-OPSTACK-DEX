// Kill switch for quote sources: DISABLED_SOURCES=zerion,fusion (comma separated).
//
// When a provider misbehaves (an outage, a bad key, a bill you don't want), add it to
// DISABLED_SOURCES in Render and redeploy: no code change. Server-proxied sources answer
// 503 "turned off"; /api/health lists the disabled names so the app skips ALL of them,
// including the ones the browser calls directly (Aerodrome, KyberSwap, LI.FI, Velora).

export const KNOWN_SOURCES = [
  "aerodrome",
  "velodrome",
  "uniswap",
  "kyberswap",
  "lifi",
  "velora",
  "coinbase",
  "oneinch",
  "fusion",
  "zerox",
  "zerion",
];

// Server routes that belong to one source.
const ROUTES = [
  [/^\/api\/uniswap\//, "uniswap"],
  [/^\/api\/oneinch\//, "oneinch"],
  [/^\/api\/fusion\//, "fusion"],
  [/^\/api\/zerox\//, "zerox"],
  [/^\/api\/zerion\//, "zerion"],
  [/^\/api\/coinbase\/swap-quote/, "coinbase"],
];

export function disabledSources(env = process.env) {
  return (env.DISABLED_SOURCES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => KNOWN_SOURCES.includes(s));
}

export function sourceForPath(path) {
  const hit = ROUTES.find(([re]) => re.test(path));
  return hit ? hit[1] : null;
}

/** Express middleware: 503 for a disabled source's routes. Reads the env on every call. */
export function switchesMiddleware(env = process.env) {
  return (req, res, next) => {
    const src = sourceForPath(req.originalUrl.split("?")[0]);
    if (src && disabledSources(env).includes(src)) {
      return res.status(503).json({ error: `${src} is turned off` });
    }
    next();
  };
}
