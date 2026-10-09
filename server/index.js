// DEX backend: serves the frontend (prod) + key-holding API proxy.
// The CDP/Coinbase secret key lives ONLY here, via server env vars or the
// coinbase CLI config on this machine. Nothing under /api ever returns it.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import {
  cdpConfigured,
  getSpotPrices,
  createSwapQuote,
  cdpNetworkForChain,
} from "./coinbase.js";
import { startStream, getLiveTick, streamStatus } from "./stream.js";
import {
  NEAR_CHAINS,
  bridgeTokens,
  resolveAsset,
  dryQuote,
  wetQuote,
  submitDeposit,
  getStatus,
} from "./near.js";
import { UNISWAP_CHAINS, uniswapQuote, uniswapBuildSwap } from "./uniswap.js";
import {
  STARGATE_CHAINS,
  stargateTokens,
  stargateQuote,
  stargateBuildTx,
} from "./stargate.js";
import {
  aoriTokens,
  aoriQuote,
  aoriSignData,
  aoriSubmit,
  aoriStatus,
} from "./aori.js";
import {
  getVirtueScores,
  virtueMeta,
  listStrategies,
  seykotaSignal,
  dashboardData,
} from "./bushido.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(express.json({ limit: "64kb" }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean) || true,
    maxAge: 600,
  })
);

// ---- tiny in-memory rate limiter: 90 req/min per IP on /api ----
const hits = new Map();
app.use("/api", (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || "unknown";
  const rec = hits.get(ip) || { count: 0, reset: now + 60_000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60_000; }
  rec.count += 1;
  hits.set(ip, rec);
  if (rec.count > 90) return res.status(429).json({ error: "rate_limited" });
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, coinbase: cdpConfigured(), stream: streamStatus(), time: new Date().toISOString() });
});

// GET /api/coinbase/prices?products=ETH-USD,BTC-USD
// Prefers the live WS ticker cache (fresh < 20s); falls back to REST per product.
app.get("/api/coinbase/prices", async (req, res) => {
  try {
    const raw = String(req.query.products || "ETH-USD");
    const products = raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9-]{3,20}$/.test(s));
    if (!products.length) return res.status(400).json({ error: "no valid products" });
    const prices = {};
    const restNeeded = [];
    for (const p of products) {
      const t = getLiveTick(p);
      if (t) prices[p] = { price: t.price, bid: null, ask: null, time: t.time, via: "ws" };
      else restNeeded.push(p);
    }
    if (restNeeded.length) {
      const rest = await getSpotPrices(restNeeded);
      for (const [k, v] of Object.entries(rest)) prices[k] = { ...v, via: "rest" };
    }
    res.json({ prices });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// POST /api/coinbase/swap-quote
// { chainId, fromToken, toToken, fromAmount (atomic string), takerAddress, slippageBps? }
// Returns a quote whose tx the USER's wallet signs. Server never signs or holds user funds.
app.post("/api/coinbase/swap-quote", async (req, res) => {
  try {
    const { chainId, fromToken, toToken, fromAmount, takerAddress, slippageBps } = req.body || {};
    if (!Number.isInteger(Number(chainId))) return res.status(400).json({ error: "bad chainId" });
    if (!cdpNetworkForChain(chainId)) return res.status(400).json({ error: "chain not supported by CDP swaps" });
    if (!fromAmount || !/^\d{1,40}$/.test(String(fromAmount))) return res.status(400).json({ error: "bad fromAmount" });
    const slippage = slippageBps == null ? 100 : Number(slippageBps);
    if (!Number.isInteger(slippage) || slippage < 1 || slippage > 5000) {
      return res.status(400).json({ error: "bad slippageBps" });
    }
    const quote = await createSwapQuote({
      chainId: Number(chainId),
      fromToken, toToken,
      fromAmount: String(fromAmount),
      taker: takerAddress,
      slippageBps: slippage,
    });
    res.json({ quote });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// ---- NEAR Intents bridging (keyless 1Click API) ----
// GET /api/near/tokens?chainId=8453 — bridgable tokens on a chain
app.get("/api/near/tokens", async (req, res) => {
  try {
    const chainId = Number(req.query.chainId);
    if (!NEAR_CHAINS[chainId]) return res.status(400).json({ error: "chain not supported by NEAR Intents" });
    res.json({ tokens: await bridgeTokens(chainId) });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

function validateBridgeBody(b) {
  const { fromChainId, toChainId, fromToken, toToken, amountAtomic, wallet, slippageBps } = b || {};
  if (!NEAR_CHAINS[Number(fromChainId)]) return "bad fromChainId";
  if (!NEAR_CHAINS[Number(toChainId)]) return "bad toChainId";
  if (Number(fromChainId) === Number(toChainId)) return "from/to chains must differ";
  if (!fromToken || !toToken) return "missing tokens";
  if (!/^\d{1,40}$/.test(String(amountAtomic))) return "bad amountAtomic";
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(wallet || ""))) return "bad wallet";
  if (/^0x0{40}$/i.test(String(wallet))) return "wallet required";
  const slip = slippageBps == null ? 100 : Number(slippageBps);
  if (!Number.isInteger(slip) || slip < 1 || slip > 5000) return "bad slippageBps";
  return null;
}

// POST /api/near/quote — dry preview. Body: { fromChainId, toChainId, fromToken ('native'|0x…), toToken, amountAtomic, wallet, slippageBps? }
app.post("/api/near/quote", async (req, res) => {
  try {
    const err = validateBridgeBody(req.body);
    if (err) return res.status(400).json({ error: err });
    const { fromChainId, toChainId, fromToken, toToken, amountAtomic, wallet, slippageBps } = req.body;
    const [o, d] = await Promise.all([
      resolveAsset(fromChainId, fromToken),
      resolveAsset(toChainId, toToken),
    ]);
    const quote = await dryQuote({
      originAsset: o.assetId,
      destinationAsset: d.assetId,
      amount: String(amountAtomic),
      refundTo: wallet,
      recipient: wallet,
      slippageBps: slippageBps == null ? 100 : Number(slippageBps),
    });
    res.json({ quote, originAsset: o.assetId, destinationAsset: d.assetId });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// POST /api/near/intent — wet quote; returns depositAddress (valid ~10 min).
app.post("/api/near/intent", async (req, res) => {
  try {
    const err = validateBridgeBody(req.body);
    if (err) return res.status(400).json({ error: err });
    const { fromChainId, toChainId, fromToken, toToken, amountAtomic, wallet, slippageBps } = req.body;
    const [o, d] = await Promise.all([
      resolveAsset(fromChainId, fromToken),
      resolveAsset(toChainId, toToken),
    ]);
    const quote = await wetQuote({
      originAsset: o.assetId,
      destinationAsset: d.assetId,
      amount: String(amountAtomic),
      refundTo: wallet,
      recipient: wallet,
      slippageBps: slippageBps == null ? 100 : Number(slippageBps),
    });
    res.json({ quote });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// POST /api/near/deposit-submit — { depositAddress, txHash }; speeds up processing after the user deposits.
app.post("/api/near/deposit-submit", async (req, res) => {
  try {
    const { depositAddress, txHash } = req.body || {};
    const r = await submitDeposit({ depositAddress, txHash });
    res.json({ ok: true, r });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// GET /api/near/status?depositAddress=0x… — poll until terminal (SUCCESS/FAILED/REFUNDED/INCOMPLETE_DEPOSIT)
app.get("/api/near/status", async (req, res) => {
  try {
    const s = await getStatus(String(req.query.depositAddress || ""));
    res.json(s);
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// ---- Uniswap Trading API (key in Secure Vault, server-side only) ----
// POST /api/uniswap/quote — { chainId, tokenIn, tokenOut, amountAtomic, takerAddress, slippageBps? }
// Returns a normalized quote; the USER's wallet signs the tx from /api/uniswap/swap.
app.post("/api/uniswap/quote", async (req, res) => {
  try {
    const { chainId, tokenIn, tokenOut, amountAtomic, takerAddress, slippageBps } = req.body || {};
    if (!UNISWAP_CHAINS.has(Number(chainId))) return res.status(400).json({ error: "chain not supported by Uniswap" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(tokenIn || ""))) return res.status(400).json({ error: "bad tokenIn" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(tokenOut || ""))) return res.status(400).json({ error: "bad tokenOut" });
    if (!/^\d{1,40}$/.test(String(amountAtomic))) return res.status(400).json({ error: "bad amountAtomic" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(takerAddress || ""))) return res.status(400).json({ error: "bad takerAddress" });
    const slip = slippageBps == null ? 50 : Number(slippageBps);
    if (!Number.isInteger(slip) || slip < 1 || slip > 5000) return res.status(400).json({ error: "bad slippageBps" });
    const quote = await uniswapQuote({
      chainId: Number(chainId),
      tokenIn, tokenOut,
      amountAtomic: String(amountAtomic),
      taker: takerAddress,
      slippageBps: slip,
    });
    res.json({ quote });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// POST /api/uniswap/swap — { quote: <rawQuote from /api/uniswap/quote> }
// Returns the executable {to, data, value} for the user's wallet to sign.
app.post("/api/uniswap/swap", async (req, res) => {
  try {
    const { quote } = req.body || {};
    const tx = await uniswapBuildSwap(quote);
    res.json({ tx });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// ---- Stargate V2 bridging (keyless, on-chain; same-asset only) ----
// GET /api/stargate/tokens?chainId=8453 — pool-backed tokens on a chain
app.get("/api/stargate/tokens", (req, res) => {
  const chainId = Number(req.query.chainId);
  if (!STARGATE_CHAINS.includes(chainId)) return res.status(400).json({ error: "chain not supported by Stargate" });
  res.json({ tokens: stargateTokens(chainId), chains: STARGATE_CHAINS });
});

// POST /api/stargate/quote — { fromChainId, toChainId, tokenRef ('NATIVE'|'USDC'|'USDT'), amountAtomic, recipient }
// Returns quote + sendParam/messagingFee; the USER's wallet signs sendToken.
app.post("/api/stargate/quote", async (req, res) => {
  try {
    const { fromChainId, toChainId, tokenRef, amountAtomic, recipient } = req.body || {};
    if (!STARGATE_CHAINS.includes(Number(fromChainId))) return res.status(400).json({ error: "bad fromChainId" });
    if (!STARGATE_CHAINS.includes(Number(toChainId))) return res.status(400).json({ error: "bad toChainId" });
    if (Number(fromChainId) === Number(toChainId)) return res.status(400).json({ error: "from/to chains must differ" });
    if (!/^\d{1,40}$/.test(String(amountAtomic))) return res.status(400).json({ error: "bad amountAtomic" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(recipient || ""))) return res.status(400).json({ error: "bad recipient" });
    const quote = await stargateQuote({ fromChainId, toChainId, tokenRef, amountAtomic, recipient });
    res.json({ quote });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// POST /api/stargate/build-tx — { quote, refundAddress } -> { to, data, value } for the wallet to sign.
// Wallet must approve(token -> pool) first for ERC-20 tokens.
app.post("/api/stargate/build-tx", (req, res) => {
  try {
    const { quote, refundAddress } = req.body || {};
    if (!quote?.pool || !quote?.sendParam) return res.status(400).json({ error: "bad quote" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(refundAddress || ""))) return res.status(400).json({ error: "bad refundAddress" });
    res.json({ tx: stargateBuildTx(quote, refundAddress) });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// ---- Aori intent-based bridging (keyless quotes; user signs EIP-712 order) ----
// Chain keys: base, optimism, ethereum, arbitrum, monad, etc. (from GET /chains)
// GET /api/aori/tokens?chainKey=base — tokens Aori can bridge on a chain
app.get("/api/aori/tokens", async (req, res) => {
  try {
    const chainKey = String(req.query.chainKey || "").toLowerCase();
    if (!/^[a-z0-9-]{2,20}$/.test(chainKey)) return res.status(400).json({ error: "bad chainKey" });
    res.json({ tokens: await aoriTokens(chainKey) });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// POST /api/aori/quote — { fromChainKey, toChainKey, fromToken ('native'|0x…), toToken, amountAtomic, wallet }
// Returns { order, fi, ti }; order includes orderHash for signing.
app.post("/api/aori/quote", async (req, res) => {
  try {
    const { fromChainKey, toChainKey, fromToken, toToken, amountAtomic, wallet } = req.body || {};
    if (!fromChainKey || !toChainKey) return res.status(400).json({ error: "missing chains" });
    if (fromChainKey === toChainKey) return res.status(400).json({ error: "from/to chains must differ" });
    if (!fromToken || !toToken) return res.status(400).json({ error: "missing tokens" });
    if (!/^\d{1,40}$/.test(String(amountAtomic))) return res.status(400).json({ error: "bad amountAtomic" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(wallet || ""))) return res.status(400).json({ error: "bad wallet" });
    const r = await aoriQuote({ fromChainKey, toChainKey, fromToken, toToken, amountAtomic, wallet });
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// POST /api/aori/sign-data — { order } -> { domain, types, message } for wallet signTypedData.
// fromChainKey determines the verifying contract + chainId.
app.post("/api/aori/sign-data", async (req, res) => {
  try {
    const { order, fromChainKey } = req.body || {};
    if (!order?.orderHash || !fromChainKey) return res.status(400).json({ error: "bad order" });
    res.json(await aoriSignData(order, String(fromChainKey).toLowerCase()));
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// POST /api/aori/swap — { orderHash, signature } -> submits signed order for maker fill.
app.post("/api/aori/swap", async (req, res) => {
  try {
    const { orderHash, signature } = req.body || {};
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(orderHash || ""))) return res.status(400).json({ error: "bad orderHash" });
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(signature || ""))) return res.status(400).json({ error: "bad signature" });
    res.json(await aoriSubmit({ orderHash, signature }));
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// GET /api/aori/status?orderHash=0x… — poll until completed/failed.
app.get("/api/aori/status", async (req, res) => {
  try {
    res.json(await aoriStatus(String(req.query.orderHash || "")));
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// ---- Bushido trading dashboard (virtue scores + Seykota signals) ----
// GET /api/bushido/virtues?trader=0x… — 7-virtue scores (0-1 scale)
app.get("/api/bushido/virtues", async (req, res) => {
  try {
    const trader = String(req.query.trader || "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(trader)) return res.status(400).json({ error: "bad trader" });
    const { scores, source } = await getVirtueScores(trader);
    res.json({ virtues: virtueMeta().map((m) => ({ ...m, score: scores[m.id] ?? 0.5 })), source });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// GET /api/bushido/strategies — strategy list
app.get("/api/bushido/strategies", (_req, res) => {
  res.json({ strategies: listStrategies() });
});

// POST /api/bushido/signal — { prices: number[], trader? } -> Seykota signal
app.post("/api/bushido/signal", async (req, res) => {
  try {
    const { prices, trader } = req.body || {};
    if (!Array.isArray(prices) || prices.length < 5) return res.status(400).json({ error: "need price history" });
    let scores = null;
    if (trader && /^0x[0-9a-fA-F]{40}$/.test(trader)) {
      ({ scores } = await getVirtueScores(trader));
    }
    res.json({ signal: seykotaSignal(prices.map(Number), scores) });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// GET /api/bushido/dashboard?trader=0x… — full dashboard payload
app.get("/api/bushido/dashboard", async (req, res) => {
  try {
    const trader = String(req.query.trader || "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(trader)) return res.status(400).json({ error: "bad trader" });
    res.json(await dashboardData(trader));
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 200) });
  }
});

// ---- serve the built frontend in production ----
const distDir = path.join(__dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

// ---- live price stream (Coinbase Advanced Trade WS; REST fallback) ----
startStream((process.env.WS_PRODUCTS || "BTC-USD,ETH-USD").split(","));

app.listen(PORT, () => {
  console.log(`DEX server on :${PORT} | coinbase=${cdpConfigured() ? "keyed" : "NO KEY"}`);
});
