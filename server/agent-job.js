// Bushido-Trades: the paid ERC-8004 agent endpoint (x402, 0.01 USDC per job on Base).
//
// POST /api/agent/job runs one job: the market regime (five markets, Coinbase data) blended with the Seykota EMA trend
// (server/macro.js) for ETH, then a swap quote on Base in the direction the signal points (USDC -> WETH for a
// long, WETH -> USDC for a short). The quote is asked of every source whose key is already on the server
// (0x, 1inch, Uniswap, Zerion) at once: the best answer wins and every answer is listed. The quote is for the
// caller's own wallet; this server never holds anyone's funds.
//
// Payment follows x402 (v1, scheme "exact"):
//   1. No X-PAYMENT header -> 402 with the payment requirements.
//   2. X-PAYMENT present -> the payment is verified, the job runs, then the payment is collected on Base.
//      A job that fails is never collected, so the caller is not charged. A collection failure returns 402
//      and no result. Bad input gets 400 before any payment is looked at.
//   3. Success -> 200 with the result and an X-PAYMENT-RESPONSE header (the Base transaction).
//
// Who collects the payment (the first one set up wins):
//   1. X402_FACILITATOR_URL, a facilitator of the owner's choice (not set today).
//   2. Coinbase CDP's facilitator, when CDP_API_KEY_ID / CDP_API_KEY_SECRET are set (not on Render today).
//   3. The server itself (server/x402-local.js), paying the Base gas with the wallet key it already holds
//      (FAUCET_PRIVATE_KEY, or X402_SETTLER_KEY). This is what runs on Render today.
// With none, the endpoint answers 503 and charges nothing. DISABLED_SOURCES=agent switches it off.
//
// Addresses were read on Base: USDC 0x8335…2913 (name "USD Coin", version "2", 6 decimals),
// WETH 0x4200…0006 (18 decimals). Both also in src/dex/chains.js.

import { ethers } from "ethers";
import { zeroxParams, zeroxKey } from "./zerox.js";
import { oneinchQuote } from "./oneinch.js";
import { uniswapQuote, uniswapConfigured } from "./uniswap.js";
import { zerionQuote } from "./zerion.js";
import { settlerKey, createBaseChain, createLocalFacilitator, BASE_RPCS } from "./x402-local.js";
import { CHAINS } from "../src/dex/chains.js";

export const BASE_CHAIN_ID = 8453;
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const WETH_BASE = "0x4200000000000000000000000000000000000006";
export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const DEFAULT_PAY_TO = "0xBA397fAae1D5Fe10C0356f2e585bef34577ab111";
export const DEFAULT_PUBLIC_URL = "https://bushido-dapp.onrender.com";
export const CDP_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";
export const AGENT_NAME = "Bushido-Trades";
export const AGENT_DESCRIPTION =
  "Bushido-aligned trading agent on Base. Tell it which coin to swap into: each job quotes the trade on Base " +
  "across 0x, 1inch, Uniswap and Zerion and returns the best price, with the market read (the regime from ETH, " +
  "BTC, AERO, VIRTUAL and DEGEN on Coinbase data, and the Seykota trend), for the caller's own wallet to sign.";
const JOB_PATH = "/api/agent/job";
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const ZEROX_QUOTE = "https://api.0x.org/swap/allowance-holder/quote";
const TOKENS = {
  [USDC_BASE]: { symbol: "USDC", decimals: 6 },
  [WETH_BASE]: { symbol: "WETH", decimals: 18 },
};

export function agentConfig(env = process.env) {
  const payTo = ADDR.test(String(env.AGENT_PAY_TO || "")) ? String(env.AGENT_PAY_TO) : DEFAULT_PAY_TO;
  const price = Number(env.AGENT_PRICE_USDC ?? 0.01);
  const priceUsdc = Number.isFinite(price) && price > 0 ? price : 0.01;
  const publicUrl = String(env.AGENT_PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, "");
  const agentId = /^\d+$/.test(String(env.AGENT_ID || "")) ? Number(env.AGENT_ID) : null;
  return {
    payTo,
    priceUsdc,
    atomic: String(Math.round(priceUsdc * 1e6)),
    publicUrl,
    resource: publicUrl + JOB_PATH,
    agentId,
    facilitatorUrl: String(env.X402_FACILITATOR_URL || "").replace(/\/+$/, "") || null,
  };
}

export function paymentRequirements(cfg) {
  return {
    scheme: "exact",
    network: "base",
    maxAmountRequired: cfg.atomic,
    resource: cfg.resource,
    description: `${AGENT_NAME}: best Base swap quote across 0x, 1inch, Uniswap and Zerion, with the market read`,
    mimeType: "application/json",
    payTo: cfg.payTo,
    maxTimeoutSeconds: 300,
    asset: USDC_BASE,
    extra: { name: "USD Coin", version: "2" },
  };
}

/** ERC-8004 registration file, also served at /.well-known/agent-card.json. */
export function registrationFile(cfg) {
  const origin = new URL(cfg.resource).origin;
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    // ERC-8004 explorers need a real image URL and a "web" service that opens a page; the paid job endpoint (POST
    // behind x402) is listed as its own service, and agentWallet matches the wallet the registry holds for this agent.
    image: `${origin}/Bushido-dApp/icons/icon-512.png`,
    services: [
      { name: "web", endpoint: `${origin}/` },
      { name: "x402", endpoint: cfg.resource },
      { name: "agentWallet", endpoint: `eip155:${BASE_CHAIN_ID}:${cfg.payTo}` },
      { name: "A2A", endpoint: `${origin}/.well-known/agent-card.json`, version: "0.3.0" },
    ],
    x402Support: true,
    pricing: {
      model: "per-job",
      scheme: "exact",
      network: "base",
      chainId: BASE_CHAIN_ID,
      asset: USDC_BASE,
      symbol: "USDC",
      amount: String(cfg.priceUsdc),
      maxAmountRequired: cfg.atomic,
      payTo: cfg.payTo,
    },
    active: true,
    supportedTrust: ["reputation"],
    registrations:
      cfg.agentId == null
        ? []
        : [{ agentId: cfg.agentId, agentRegistry: `eip155:${BASE_CHAIN_ID}:${IDENTITY_REGISTRY}` }],
  };
}

/** Agent 1218803 is an earlier, duplicate registration of Bushido-Trades by the same wallet; 1219431 is the real one. */
export const RETIRED_AGENT_ID = 1218803;
export const RETIRED_PATH = `/.well-known/agent-retired-${RETIRED_AGENT_ID}.json`;

/** Registration file for the retired duplicate: marked inactive and pointing readers to the live agent. */
export function retiredRegistrationFile(cfg) {
  const origin = new URL(cfg.resource).origin;
  const live = cfg.agentId ?? 1219431;
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `${AGENT_NAME} (retired duplicate)`,
    description: `Retired duplicate registration. The live ${AGENT_NAME} agent is agentId ${live} on the same registry (eip155:${BASE_CHAIN_ID}:${IDENTITY_REGISTRY}); hire it there.`,
    image: `${origin}/Bushido-dApp/icons/icon-512.png`,
    services: [{ name: "web", endpoint: `${origin}/` }],
    x402Support: false,
    active: false,
    supportedTrust: [],
    registrations: [{ agentId: RETIRED_AGENT_ID, agentRegistry: `eip155:${BASE_CHAIN_ID}:${IDENTITY_REGISTRY}` }],
  };
}

/** Validate the job body. Returns { input } or { error }. Checked BEFORE any payment is touched. */
/** A coin from the verified Base list (src/dex/chains.js), by symbol (any case) or address. */
export function findBaseToken(q) {
  const s = String(q ?? "").trim();
  if (!s) return null;
  const tokens = CHAINS.base.tokens;
  if (ADDR.test(s)) return tokens.find((t) => t.address.toLowerCase() === s.toLowerCase()) || null;
  return tokens.find((t) => t.symbol.toLowerCase() === s.toLowerCase()) || null;
}

/**
 * Validate the job body. Returns { input } or { error }. Checked BEFORE any payment is touched.
 * Two kinds of job:
 *   swap:   { sell, buy, amount, taker? }   any two coins from the verified Base list; amount in the coin sold
 *   signal: { asset: "ETH", amountUsd, taker? }   the agent picks the direction from the ETH signal
 */
export function parseJob(body = {}) {
  const taker = body.taker == null || body.taker === "" ? null : String(body.taker);
  if (taker && !ADDR.test(taker)) return { error: "bad taker address" };
  if (body.sell != null || body.buy != null) {
    const sell = findBaseToken(body.sell);
    const buy = findBaseToken(body.buy);
    const what = (x) => String(x ?? "").slice(0, 24);
    if (!sell) return { error: `unknown coin "${what(body.sell)}": use a symbol or address from the Base list` };
    if (!buy) return { error: `unknown coin "${what(body.buy)}": use a symbol or address from the Base list` };
    if (sell.address.toLowerCase() === buy.address.toLowerCase()) return { error: "sell and buy are the same coin" };
    const amount = String(body.amount ?? "").trim();
    if (!/^\d{1,15}(\.\d{1,18})?$/.test(amount)) return { error: "amount must be a number in the coin you sell" };
    const frac = amount.split(".")[1] || "";
    if (frac.length > sell.decimals) return { error: `${sell.symbol} has ${sell.decimals} decimals` };
    const sellAmount = ethers.parseUnits(amount, sell.decimals);
    if (sellAmount <= 0n) return { error: "amount must be more than 0" };
    return { input: { mode: "swap", sell, buy, amount, sellAmount: sellAmount.toString(), taker } };
  }
  const asset = String(body.asset || "ETH").toUpperCase();
  if (asset !== "ETH") return { error: "only asset ETH is supported" };
  const amountUsd = body.amountUsd == null ? 100 : Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 10_000)
    return { error: "amountUsd must be between 1 and 10000" };
  return { input: { mode: "signal", asset, amountUsd, taker } };
}

/** Long, short or none, from the blended Seykota x macro verdict. */
export function direction(blended) {
  const v = String(blended || "");
  if (v.startsWith("CONFIRMED LONG") || v.startsWith("LONG")) return "long";
  if (v.startsWith("CONFIRMED SHORT") || v.startsWith("SHORT")) return "short";
  return "none";
}

/* ---------------- quote sources: every key already on the server ---------------- */

/** Which keyed sources are set up on this server. */
export function sourcesConfigured(env = process.env) {
  return {
    "0x": Boolean(zeroxKey(env)),
    "1inch": Boolean(String(env.ONEINCH_API_KEY || "").trim()),
    uniswap: uniswapConfigured(),
    zerion: Boolean(String(env.ZERION_API_KEY || "").trim()),
  };
}

/**
 * The real sources. Each takes a trade { sellToken, buyToken, sellAmount (atomic string), taker } and returns
 * { buyAmount (atomic string), minBuyAmount?, transaction?, allowanceTarget? } or throws.
 */
export function defaultSources({ env = process.env, fetchImpl = fetch } = {}) {
  // Decimals come with the trade (any coin from the Base list); USDC/WETH are known for the ETH-signal job.
  const dec = (t, side) => t[`${side}Decimals`] ?? TOKENS[t[`${side}Token`]]?.decimals ?? 18;
  return {
    "0x": async (t) => {
      const p = zeroxParams({ chainId: String(BASE_CHAIN_ID), ...t, taker: t.taker || "" }, env);
      if (p.error) throw new Error(p.error);
      const key = zeroxKey(env);
      if (!key) throw new Error("not set up");
      const r = await fetchImpl(`${ZEROX_QUOTE}?${p.query}`, {
        headers: { "0x-api-key": key, "0x-version": "v2", Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      const q = await r.json().catch(() => ({}));
      if (!r.ok || !q.buyAmount) throw new Error(`no quote (${r.status})`);
      return {
        buyAmount: String(q.buyAmount),
        minBuyAmount: q.minBuyAmount ?? null,
        transaction: t.taker ? (q.transaction ?? null) : null,
        allowanceTarget: q.issues?.allowance?.spender ?? null,
      };
    },
    "1inch": async (t) => {
      const q = await oneinchQuote({
        chainId: BASE_CHAIN_ID,
        src: t.sellToken,
        dst: t.buyToken,
        amountAtomic: t.sellAmount,
      });
      return { buyAmount: String(q.amountOut) };
    },
    uniswap: async (t) => {
      if (!t.taker) throw new Error("needs a wallet");
      const q = await uniswapQuote({
        chainId: BASE_CHAIN_ID,
        tokenIn: t.sellToken,
        tokenOut: t.buyToken,
        amountAtomic: t.sellAmount,
        taker: t.taker,
        slippageBps: 50,
      });
      return { buyAmount: String(q.amountOut), minBuyAmount: q.minAmountOut ?? null };
    },
    zerion: async (t) => {
      if (!t.taker) throw new Error("needs a wallet");
      const q = await zerionQuote({
        chainId: BASE_CHAIN_ID,
        tokenIn: t.sellToken,
        tokenOut: t.buyToken,
        amountHuman: ethers.formatUnits(t.sellAmount, dec(t, "sell")),
        taker: t.taker,
        slippageBps: 50,
      });
      // Zerion answers in token units ("0.0123"); same conversion as src/dex/adapters.js.
      const units = (x) => ethers.parseUnits(Number(x).toFixed(dec(t, "buy")), dec(t, "buy")).toString();
      return {
        buyAmount: units(q.amountOut),
        minBuyAmount: q.minAmountOut ? units(q.minAmountOut) : null,
        transaction: { to: q.to, data: q.data, value: q.value },
        allowanceTarget: q.spender ?? null,
      };
    },
  };
}

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

/** Ask every source at once. Returns { best, answers } where answers lists each source's amount or error. */
export async function bestQuote(trade, sources, timeoutMs = 15_000) {
  const names = Object.keys(sources);
  const results = await Promise.allSettled(names.map((n) => withTimeout(sources[n](trade), timeoutMs)));
  const answers = names.map((source, i) => {
    const r = results[i];
    if (r.status === "fulfilled" && /^\d+$/.test(String(r.value?.buyAmount || "")) && BigInt(r.value.buyAmount) > 0n)
      return { source, ...r.value };
    const why = r.status === "rejected" ? String(r.reason?.message || r.reason) : "no quote";
    return { source, error: why.slice(0, 80) };
  });
  const ok = answers.filter((a) => !a.error);
  const best = ok.reduce((b, a) => (!b || BigInt(a.buyAmount) > BigInt(b.buyAmount) ? a : b), null);
  return { best, answers };
}

/**
 * Run one job. Dependencies are injected: getMacro(taker) -> macroFeed payload,
 * blend(trend, regime, gate) -> verdict, sources -> see defaultSources().
 */
export async function runJob(input, { getMacro, blend, sources }) {
  const macro = await getMacro(input.taker);
  const eth = (macro.factors || []).find((f) => f.id === "eth" && f.available);
  if (!eth) throw new Error("ETH price feed unavailable");
  // No trader address, or no virtue registry -> the virtue gate is not checked (stated in the result).
  const gate = macro.virtueGate?.status === "unknown" ? "open" : macro.virtueGate?.status;
  const verdict = blend(eth.seykota, macro.regime, gate);
  const dir = direction(verdict);
  const signal = {
    asset: "ETH",
    seykota: { signal: eth.seykota, detail: eth.seykotaDetail, ema12: eth.ema12, ema26: eth.ema26, source: eth.source },
    regime: regimeSummary(macro),
    verdict,
    direction: dir,
    virtueGate: macro.virtueGate?.status === "unknown" ? { status: "not checked" } : macro.virtueGate,
    priceUsd: eth.last,
    updatedAt: macro.updatedAt,
  };
  if (dir === "none") return { signal, quote: null, note: "No trade: the signal is neutral or conflicted." };

  const trade =
    dir === "long"
      ? {
          sellToken: USDC_BASE,
          buyToken: WETH_BASE,
          sellAmount: String(Math.round(input.amountUsd * 1e6)),
          sellDecimals: 6,
          buyDecimals: 18,
        }
      : {
          sellToken: WETH_BASE,
          buyToken: USDC_BASE,
          sellAmount: (BigInt(Math.round((input.amountUsd / eth.last) * 1e9)) * 10n ** 9n).toString(),
          sellDecimals: 18,
          buyDecimals: 6,
        };
  const { best, answers } = await bestQuote({ ...trade, taker: input.taker }, sources);
  if (!best) throw new Error("no quote from any source");
  return {
    signal,
    quote: {
      source: best.source,
      chainId: BASE_CHAIN_ID,
      side: dir === "long" ? "buy ETH with USDC" : "sell ETH for USDC",
      sellToken: trade.sellToken,
      buyToken: trade.buyToken,
      sellAmount: trade.sellAmount,
      buyAmount: best.buyAmount,
      minBuyAmount: best.minBuyAmount ?? null,
      allowanceTarget: best.allowanceTarget ?? null,
      // Unsigned transaction for the taker's own wallet, when the best source gives one directly.
      transaction: input.taker ? (best.transaction ?? null) : null,
      sources: answers.map((a) =>
        a.error ? { source: a.source, error: a.error } : { source: a.source, buyAmount: a.buyAmount },
      ),
    },
  };
}

/** The regime as a job reports it: state, score, how many markets were read and from where. */
export function regimeSummary(macro) {
  return {
    state: macro.regime,
    score: macro.regimeScore,
    markets: macro.marketsAvailable,
    of: macro.marketsTotal,
    source: [...new Set((macro.factors || []).filter((f) => f.available).map((f) => f.source))].join(" + ") || null,
  };
}

// Coins the agent has a trend for: the regime's own markets (server/macro.js), by symbol in the Base list.
const MARKET_OF = {
  ETH: "eth",
  cbBTC: "btc",
  WBTC: "btc",
  tBTC: "btc",
  AERO: "aero",
  VIRTUAL: "virtual",
  DEGEN: "degen",
};

/**
 * A swap job: the caller names the coins. The quote is asked of every keyed source; the market read says whether
 * the trend and regime favour this trade, for the coin bought (or else the coin sold) when the agent tracks it.
 */
export async function runSwapJob(input, { getMacro, blend, sources }) {
  const macro = await getMacro(input.taker);
  const gate = macro.virtueGate?.status === "unknown" ? "open" : macro.virtueGate?.status;
  const readOf = (tok) => {
    const id = MARKET_OF[tok.symbol];
    const f = id && (macro.factors || []).find((x) => x.id === id && x.available);
    if (!f) return null;
    const verdict = blend(f.seykota, macro.regime, gate);
    return {
      symbol: tok.symbol,
      trend: f.seykota,
      detail: f.seykotaDetail,
      verdict,
      direction: direction(verdict),
      priceUsd: f.last,
      source: f.source,
    };
  };
  const buyRead = readOf(input.buy);
  const sellRead = buyRead ? null : readOf(input.sell);
  // Buying what the signal favours, or selling what it does not, is "with" the signal.
  let stance = null;
  if (buyRead) stance = buyRead.direction === "long" ? "with" : buyRead.direction === "short" ? "against" : "unclear";
  else if (sellRead)
    stance = sellRead.direction === "short" ? "with" : sellRead.direction === "long" ? "against" : "unclear";

  const trade = {
    sellToken: input.sell.address,
    buyToken: input.buy.address,
    sellAmount: input.sellAmount,
    sellDecimals: input.sell.decimals,
    buyDecimals: input.buy.decimals,
  };
  const { best, answers } = await bestQuote({ ...trade, taker: input.taker }, sources);
  if (!best) throw new Error("no quote from any source");
  const coin = (t) => ({ symbol: t.symbol, address: t.address, decimals: t.decimals });
  return {
    mode: "swap",
    request: { sell: { ...coin(input.sell), amount: input.amount }, buy: coin(input.buy) },
    read: {
      regime: regimeSummary(macro),
      about: buyRead || sellRead,
      side: buyRead ? "buy" : sellRead ? "sell" : null,
      stance,
      virtueGate: macro.virtueGate?.status === "unknown" ? { status: "not checked" } : macro.virtueGate,
      updatedAt: macro.updatedAt,
    },
    quote: {
      source: best.source,
      chainId: BASE_CHAIN_ID,
      sellToken: trade.sellToken,
      buyToken: trade.buyToken,
      sellAmount: trade.sellAmount,
      buyAmount: best.buyAmount,
      minBuyAmount: best.minBuyAmount ?? null,
      allowanceTarget: best.allowanceTarget ?? null,
      // Unsigned transaction for the taker's own wallet, when the best source gives one directly.
      transaction: input.taker ? (best.transaction ?? null) : null,
      sources: answers.map((a) =>
        a.error ? { source: a.source, error: a.error } : { source: a.source, buyAmount: a.buyAmount },
      ),
    },
  };
}

/* ---------------- payment collection ---------------- */

const b64json = (s) => JSON.parse(Buffer.from(String(s), "base64").toString("utf8"));
const tob64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

/** Auth headers for the CDP facilitator, signed per request with the server's CDP key. */
export async function cdpAuthHeaders(method, url, env = process.env) {
  const keyId = env.CDP_API_KEY_ID;
  const keySecret = env.CDP_API_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
  const u = new URL(url);
  const jwt = await generateJwt({
    apiKeyId: keyId,
    apiKeySecret: keySecret,
    requestMethod: method,
    requestHost: u.host,
    requestPath: u.pathname,
  });
  return { Authorization: `Bearer ${jwt}` };
}

/** Facilitator: a custom URL, then CDP, then the server's own settler. Null when none is set up. */
export function createFacilitator({
  env = process.env,
  fetchImpl = fetch,
  authHeaders = cdpAuthHeaders,
  chainFactory = createBaseChain,
} = {}) {
  const cfg = agentConfig(env);
  const useCdp = !cfg.facilitatorUrl && Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET);
  const base = cfg.facilitatorUrl || (useCdp ? CDP_FACILITATOR : null);
  if (base) {
    async function call(op, paymentPayload, paymentRequirements) {
      const url = `${base}/${op}`;
      const auth = useCdp ? await authHeaders("POST", url, env) : {};
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth || {}) },
        body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
        signal: AbortSignal.timeout(30_000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(`facilitator ${op} ${r.status}: ${String(j.errorMessage || j.error || "").slice(0, 120)}`);
      return j;
    }
    return {
      kind: useCdp ? "cdp" : "custom",
      status: async () => ({ ready: true }),
      verify: (p, req) => call("verify", p, req),
      settle: (p, req) => call("settle", p, req),
    };
  }
  const key = settlerKey(env);
  if (!key) return null;
  const rpc = String(env.BASE_RPC || "").trim();
  const rpcs = rpc && !BASE_RPCS.includes(rpc) ? [rpc, ...BASE_RPCS] : BASE_RPCS;
  return createLocalFacilitator({ chain: chainFactory({ key, rpcs, usdc: USDC_BASE }) });
}

/** Express handlers: { info, job, card, retiredCard, enabled, kind }. */
export function createAgentJob({
  env = process.env,
  facilitator,
  getMacro,
  blend,
  sources,
  fetchImpl = fetch,
  marketReady = async () => ({ ready: true }),
} = {}) {
  const cfg = agentConfig(env);
  const fac = facilitator === undefined ? createFacilitator({ env, fetchImpl }) : facilitator;
  const quoteSources = sources || defaultSources({ env, fetchImpl });
  const reqs = paymentRequirements(cfg);
  const need = (res, error) => res.status(402).json({ x402Version: 1, error, accepts: [reqs] });
  const inflight = new Set();

  // Payment readiness, cached briefly so the info route does not ask Base on every visit.
  let statusCache = { at: 0, value: null };
  async function paymentStatus() {
    if (!fac) return { payments: "off", note: "Payments are not set up on this server." };
    if (Date.now() - statusCache.at < 30_000 && statusCache.value) return statusCache.value;
    // Both must hold: the payment can be collected, and the market data every job needs can be read.
    const [p, m] = await Promise.all([
      fac.status().catch(() => ({ ready: false, reason: "Payment check failed." })),
      marketReady().catch(() => ({ ready: false, reason: "Market data check failed, so hiring is paused." })),
    ]);
    const s = !p.ready ? p : m;
    const value = s.ready ? { payments: "enabled" } : { payments: "paused", note: s.reason };
    statusCache = { at: Date.now(), value };
    return value;
  }

  return {
    enabled: Boolean(fac),
    kind: fac?.kind ?? null,
    async info(_req, res) {
      const configured = sourcesConfigured(env);
      res.json({
        agent: {
          name: AGENT_NAME,
          description: AGENT_DESCRIPTION,
          priceUsdc: cfg.priceUsdc,
          network: "base",
          payTo: cfg.payTo,
          agentId: cfg.agentId,
          registry: IDENTITY_REGISTRY,
          sources: Object.keys(configured).filter((k) => configured[k]),
        },
        method: "POST",
        body: {
          swap: {
            sell: "a coin from the Base list, symbol or address (e.g. USDC)",
            buy: "a coin from the Base list (e.g. AERO)",
            amount: "how much of the sold coin (e.g. 100)",
            taker: "0x… (optional; adds a signable tx and Uniswap/Zerion quotes)",
          },
          signal: { asset: "ETH", amountUsd: "1-10000 (default 100)", taker: "0x… (optional)" },
        },
        ...(await paymentStatus()),
        accepts: [reqs],
      });
    },
    async job(req, res) {
      const parsed = parseJob(req.body || {});
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (!fac) return res.status(503).json({ error: "payments are not set up on this server", accepts: [reqs] });

      const header = req.get?.("X-PAYMENT") ?? req.headers?.["x-payment"];
      if (!header) return need(res, "X-PAYMENT header is required");
      let payload;
      try {
        payload = b64json(header);
      } catch {
        return need(res, "X-PAYMENT is not valid base64 JSON");
      }
      const a = payload?.payload?.authorization || {};
      const flightKey = a.from && a.nonce ? `${String(a.from).toLowerCase()}:${a.nonce}` : String(header);
      if (inflight.has(flightKey)) return res.status(409).json({ error: "this payment is already being processed" });
      inflight.add(flightKey);
      try {
        try {
          const v = await fac.verify(payload, reqs);
          if (!v.isValid) return need(res, `payment invalid: ${v.invalidReason || "unknown"}`);
        } catch (e) {
          return res.status(e?.status || 502).json({ error: String(e.message).slice(0, 200), charged: false });
        }

        let result;
        try {
          const run = parsed.input.mode === "swap" ? runSwapJob : runJob;
          result = await run(parsed.input, { getMacro, blend, sources: quoteSources });
        } catch (e) {
          // Not collected -> the payer is not charged.
          return res.status(502).json({ error: String(e.message).slice(0, 200), charged: false });
        }

        let s;
        try {
          s = await fac.settle(payload, reqs);
        } catch (e) {
          return need(res, String(e.message).slice(0, 200));
        }
        if (!s.success) return need(res, `payment could not be collected: ${s.errorReason || "unknown"}`);

        res.set(
          "X-PAYMENT-RESPONSE",
          tob64({ success: true, transaction: s.transaction, network: s.network || "base", payer: s.payer }),
        );
        res.json({
          agent: AGENT_NAME,
          ...result,
          payment: { transaction: s.transaction, payer: s.payer, pending: Boolean(s.pending) },
        });
      } finally {
        inflight.delete(flightKey);
      }
    },
    card(_req, res) {
      res.json(registrationFile(cfg));
    },
    retiredCard(_req, res) {
      res.json(retiredRegistrationFile(cfg));
    },
  };
}
