// Request limits per visitor (IP), in two buckets.
//
// One quote asks up to ~6 server-side sources at once. With a single 90 per minute
// bucket for everything, a person changing amounts hit the limit after ~15 quotes and
// every source then failed with "rate_limited". So quote lookups get their own, larger
// bucket; everything else (builds, status, logs, claims) keeps the small one.

const WINDOW_MS = 60_000;

export const QUOTE_PATH =
  /^\/api\/(uniswap\/quote|oneinch\/quote|zerox\/quote|zerion\/quote|coinbase\/swap-quote|fusion\/(quoter|orders)\/)/;

// `perkMultiplier(req)` -> number >= 1 raises the quote bucket for verified Dojo Pass holders (server/perks.js).
export function createLimiter({
  general = 90,
  quotes = 400,
  windowMs = WINDOW_MS,
  now = () => Date.now(),
  perkMultiplier = () => 1,
} = {}) {
  const buckets = new Map(); // "ip|bucket" -> { count, reset }
  return (req, res, next) => {
    const t = now();
    const bucket = QUOTE_PATH.test(req.originalUrl.split("?")[0]) ? "quotes" : "general";
    const limit = bucket === "quotes" ? Math.round(quotes * (perkMultiplier(req) || 1)) : general;
    const key = `${req.ip || "unknown"}|${bucket}`;
    let rec = buckets.get(key);
    if (!rec || t > rec.reset) {
      rec = { count: 0, reset: t + windowMs };
      buckets.set(key, rec);
    }
    rec.count += 1;
    // Keep memory bounded: drop expired entries once the table gets large.
    if (buckets.size > 5000) for (const [k, r] of buckets) if (t > r.reset) buckets.delete(k);
    if (rec.count > limit) return res.status(429).json({ error: "rate_limited" });
    next();
  };
}

/**
 * What the server sees about the caller's connection, for the health page. It reports the caller's OWN request
 * data back to them, so it exposes nothing new. It exists to answer one question: is TRUST_PROXY the right
 * number for this host? (`yourIp` should be the visitor's address, not a shared proxy/CDN address.)
 */
export function proxyInfo(req, trust) {
  const raw = String(req.headers?.["x-forwarded-for"] || "");
  const chain = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8);
  return {
    trustProxy: trust === undefined || trust === false ? "off" : trust,
    yourIp: req.ip || null,
    forwardedFor: chain,
    forwardedHops: chain.length,
    behindCdn: Boolean(req.headers?.["cf-ray"]),
  };
}
