// Retry-once + pause for flaky quote services.
//   * A temporary failure (5xx, network error) is retried ONCE after a short delay.
//   * A timeout is not retried (the caller already waited), and permanent errors
//     (400/401/403, "API key not set", "no liquidity") are never retried.
//   * After a failed call the key is paused (60s, growing on repeat failures): calls fail fast with
//     "temporarily unavailable" instead of hitting the broken service again.
// Only ever wrap read-only quote calls, never signing or sending.

// Pause grows with each consecutive failure (1 min, 2, 5, 15 and then 30 min at most)
// and resets to the start after the first success.
export const PAUSE_STEPS_MS = [60_000, 120_000, 300_000, 900_000, 1_800_000];
export const PAUSE_MS = PAUSE_STEPS_MS[0];
const strikes = new Map(); // key -> consecutive failed rounds
export const RETRY_DELAY_MS = 1000;
const paused = new Map(); // key -> resume time

export function isTransient(err) {
  const m = String(err?.message || err || '');
  if (/timeout/i.test(m)) return false;
  if (/key not set|rejected|no liquidity|not supported|\b(400|401|403|404)\b/i.test(m)) return false;
  return /\b5\d\d\b|NATS|fetch failed|network|ECONN|ENOTFOUND|socket|Failed to fetch/i.test(m);
}

export function pausedFor(key, now = Date.now()) {
  const t = paused.get(key) || 0;
  return t > now ? t - now : 0;
}

export function _resetPauses() {
  paused.clear();
  strikes.clear();
}

export async function resilient(
  key,
  fn,
  { delay = RETRY_DELAY_MS, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  const left = pausedFor(key, now());
  if (left) throw new Error(`temporarily unavailable (retry in ${Math.ceil(left / 1000)}s)`);
  try {
    const out = await fn();
    strikes.delete(key);
    return out;
  } catch (e) {
    if (isTransient(e)) {
      await sleep(delay);
      try {
        return await fn();
      } catch (e2) {
        e = e2;
      }
    }
    // Pause on service trouble only; user/key/liquidity errors are not the service's fault.
    if (isTransient(e) || /timeout/i.test(String(e?.message))) {
      const n = strikes.get(key) || 0;
      strikes.set(key, n + 1);
      paused.set(key, now() + PAUSE_STEPS_MS[Math.min(n, PAUSE_STEPS_MS.length - 1)]);
    }
    throw e;
  }
}
