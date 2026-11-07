// Request limits per visitor (IP), in two buckets.
//
// One quote asks up to ~6 server-side sources at once. With a single 90 per minute
// bucket for everything, a person changing amounts hit the limit after ~15 quotes and
// every source then failed with "rate_limited". So quote lookups get their own, larger
// bucket; everything else (builds, status, logs, claims) keeps the small one.

const WINDOW_MS = 60_000;

export const QUOTE_PATH =
  /^\/api\/(uniswap\/quote|oneinch\/quote|zerox\/quote|zerion\/quote|coinbase\/swap-quote|fusion\/(quoter|orders)\/)/;

export function createLimiter({ general = 90, quotes = 400, windowMs = WINDOW_MS, now = () => Date.now() } = {}) {
  const buckets = new Map(); // "ip|bucket" -> { count, reset }
  return (req, res, next) => {
    const t = now();
    const bucket = QUOTE_PATH.test(req.originalUrl.split("?")[0]) ? "quotes" : "general";
    const limit = bucket === "quotes" ? quotes : general;
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
