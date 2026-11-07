// Operations log: keeps recent errors in memory and escalates high-severity ones
// by email through Resend. Keys stay server-side (RESEND_API_KEY, ALERT_EMAIL_TO,
// ALERT_EMAIL_FROM); with none set, entries are still logged and escalation is skipped.

const MAX = 200;
const SEVERITIES = ["info", "warn", "high"];
const entries = [];
const lastSent = new Map(); // dedupe key -> timestamp

export function opsConfigured(env = process.env) {
  return Boolean(env.RESEND_API_KEY && env.ALERT_EMAIL_TO);
}

export function recentOps(limit = 50) {
  return entries.slice(-limit).reverse();
}

export function _resetOps() {
  entries.length = 0;
  lastSent.clear();
}

const clip = (v, n) => String(v ?? "").slice(0, n);

/** Record an entry; email it if severity is "high" (max one email per message per 10 min). */
export async function logOps(input, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const severity = SEVERITIES.includes(input?.severity) ? input.severity : "warn";
  const entry = {
    at: new Date(now).toISOString(),
    severity,
    source: clip(input?.source || "app", 40),
    message: clip(input?.message || "unknown error", 300),
    escalated: false,
  };
  entries.push(entry);
  if (entries.length > MAX) entries.shift();

  if (severity === "high" && opsConfigured(env)) {
    const key = `${entry.source}:${entry.message}`;
    if (now - (lastSent.get(key) || 0) > 10 * 60_000) {
      lastSent.set(key, now);
      try {
        const r = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: env.ALERT_EMAIL_FROM || "Bushido Ops <onboarding@resend.dev>",
            to: env.ALERT_EMAIL_TO.split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            subject: `[Bushido] HIGH: ${entry.message.slice(0, 80)}`,
            text: `${entry.at}\nsource: ${entry.source}\n\n${entry.message}`,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        entry.escalated = r.ok;
      } catch {
        /* logging must never throw */
      }
    }
  }
  return entry;
}
