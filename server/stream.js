// Live price stream from Coinbase Advanced Trade WebSocket.
// Host: wss://advanced-trade-ws.coinbase.com (public market-data host).
// The ticker channel is public — no API key needed.
//
// Design: best-effort. The socket keeps the latest tick per product in
// memory; /api/coinbase/prices prefers it when fresh (< 20s) and falls back
// to the REST ticker otherwise. If the WS never connects, behavior is
// identical to the pre-stream REST-only build.
//
// Wire format follows the Advanced Trade WS v3 protocol as used by
// coinbase-advanced-py: subscribe { type, product_ids, channels }, ticker
// events arrive as { channel: "ticker", events: [{ tickers: [...] }] }.

const WS_URL = "wss://advanced-trade-ws.coinbase.com";
const FRESH_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;

const cache = new Map(); // productId -> { price, time, receivedAt }
let socket = null;
let products = [];
let backoffMs = 2000;
let lastMessageAt = 0;
let started = false;

function log(...a) {
  console.log("[stream]", ...a);
}

function handleMessage(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (m.channel !== "ticker" && m.type !== "ticker") return;
  lastMessageAt = Date.now();
  const tickers = m.events?.flatMap((e) => e.tickers || []) || [];
  // Legacy shape fallback: { type: "ticker", product_id, price }
  if (!tickers.length && m.product_id && m.price) tickers.push(m);
  for (const t of tickers) {
    if (!t.product_id || !t.price) continue;
    cache.set(t.product_id.toUpperCase(), {
      price: String(t.price),
      time: t.time || new Date().toISOString(),
      receivedAt: Date.now(),
    });
  }
}

function connect() {
  if (typeof WebSocket === "undefined") {
    log("native WebSocket unavailable (node < 21?) — REST fallback only");
    return;
  }
  try {
    socket = new WebSocket(WS_URL);
  } catch (e) {
    log("connect failed:", e.message);
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    log("connected, subscribing:", products.join(","));
    backoffMs = 2000;
    socket.send(JSON.stringify({
      type: "subscribe",
      product_ids: products,
      channels: ["ticker", "heartbeats"],
    }));
  };

  socket.onmessage = (ev) => {
    try { handleMessage(ev.data); } catch (e) { log("parse error:", e.message); }
  };

  const onDead = (why) => {
    log("socket", why, "— reconnecting");
    try { socket?.close(); } catch { /* noop */ }
    socket = null;
    scheduleReconnect();
  };
  socket.onerror = () => onDead("error");
  socket.onclose = () => onDead("closed");
}

function scheduleReconnect() {
  const wait = Math.min(backoffMs, 60_000);
  backoffMs *= 2;
  setTimeout(() => { if (started) connect(); }, wait);
}

// Watchdog: if no tick for a while, reconnect (silent stall guard).
setInterval(() => {
  if (!started || !socket) return;
  if (Date.now() - lastMessageAt > HEARTBEAT_TIMEOUT_MS && lastMessageAt !== 0) {
    log("no ticks for 30s — reconnecting");
    try { socket.close(); } catch { /* noop */ }
  }
}, 10_000).unref();

export function startStream(productIds) {
  if (started) return;
  started = true;
  products = (productIds || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean).slice(0, 20);
  if (!products.length) {
    log("no products configured — stream disabled");
    return;
  }
  lastMessageAt = 0;
  connect();
}

/** Fresh live tick for a product, or null when absent/stale. */
export function getLiveTick(productId) {
  const t = cache.get(String(productId).toUpperCase());
  if (!t) return null;
  if (Date.now() - t.receivedAt > FRESH_MS) return null;
  return t;
}

export function streamStatus() {
  return {
    running: started && products.length > 0,
    connected: !!socket && socket.readyState === 1,
    products,
    cached: [...cache.keys()],
    lastMessageAt: lastMessageAt || null,
  };
}
