// Bushido-Trades: the paid ERC-8004 agent endpoint (x402, 0.01 USDC per job on Base).
//
// POST /api/agent/job runs one job: the Druckenmiller macro regime blended with the
// Seykota EMA trend (server/macro.js) for ETH, then a 0x swap quote on Base in the
// direction the signal points (USDC -> WETH for a long, WETH -> USDC for a short).
// The quote is for the caller's own wallet to sign; this server never holds funds.
//
// Payment follows x402 (v1, scheme "exact"):
//   1. No X-PAYMENT header -> 402 with the payment requirements.
//   2. X-PAYMENT present -> the facilitator verifies it, the job runs, then the
//      facilitator settles it on Base. A job that fails is never settled, so the
//      caller is not charged. A settle failure returns 402 and no result.
//   3. Success -> 200 with the result and an X-PAYMENT-RESPONSE header (the tx).
//
// Facilitator: Coinbase CDP's x402 facilitator, signed with the CDP key the server
// already uses (CDP_API_KEY_ID / CDP_API_KEY_SECRET). X402_FACILITATOR_URL overrides it
// with a keyless facilitator. With neither, the endpoint answers 503 and charges nothing.
//
// Addresses were read on Base: USDC 0x8335…2913 (name "USD Coin", version "2",
// 6 decimals), WETH 0x4200…0006 (18 decimals). Both also in src/dex/chains.js.

import { zeroxParams, zeroxKey } from "./zerox.js";

export const BASE_CHAIN_ID = 8453;
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const WETH_BASE = "0x4200000000000000000000000000000000000006";
export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const DEFAULT_PAY_TO = "0xBA397fAae1D5Fe10C0356f2e585bef34577ab111";
export const DEFAULT_PUBLIC_URL = "https://bushido-dapp.onrender.com";
export const CDP_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";
export const AGENT_NAME = "Bushido-Trades";
const JOB_PATH = "/api/agent/job";
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const ZEROX_QUOTE = "https://api.0x.org/swap/allowance-holder/quote";

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
    description: `${AGENT_NAME}: Seykota x Druckenmiller ETH signal + Base swap quote`,
    mimeType: "application/json",
    payTo: cfg.payTo,
    maxTimeoutSeconds: 120,
    asset: USDC_BASE,
    extra: { name: "USD Coin", version: "2" },
  };
}

/** ERC-8004 registration file, also served at /.well-known/agent-card.json. */
export function registrationFile(cfg) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: AGENT_NAME,
    description:
      "Bushido-aligned trading agent on Base. Each job returns the Seykota trend x Druckenmiller macro " +
      "signal for ETH and a 0x swap quote on Base in that direction, for the caller's wallet to sign.",
    image: "",
    services: [{ name: "web", endpoint: cfg.resource }],
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

/** Validate the job body. Returns { input } or { error }. Checked BEFORE any payment is touched. */
export function parseJob(body = {}) {
  const asset = String(body.asset || "ETH").toUpperCase();
  if (asset !== "ETH") return { error: "only asset ETH is supported" };
  const amountUsd = body.amountUsd == null ? 100 : Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 10_000)
    return { error: "amountUsd must be between 1 and 10000" };
  const taker = body.taker == null || body.taker === "" ? null : String(body.taker);
  if (taker && !ADDR.test(taker)) return { error: "bad taker address" };
  return { input: { asset, amountUsd, taker } };
}

/** Long, short or none, from the blended Seykota x macro verdict. */
export function direction(blended) {
  const v = String(blended || "");
  if (v.startsWith("CONFIRMED LONG") || v.startsWith("LONG")) return "long";
  if (v.startsWith("CONFIRMED SHORT") || v.startsWith("SHORT")) return "short";
  return "none";
}

/**
 * Run one job. Dependencies are injected: getMacro(taker) -> macroFeed payload,
 * blend(trend, regime, gate) -> verdict, fetchImpl for 0x.
 */
export async function runJob(input, { getMacro, blend, fetchImpl = fetch, env = process.env }) {
  const macro = await getMacro(input.taker);
  const eth = (macro.factors || []).find((f) => f.id === "eth" && f.available);
  if (!eth) throw new Error("ETH price feed unavailable");
  // No trader address -> the virtue gate is not checked (stated in the result).
  const gate = macro.virtueGate?.status === "unknown" ? "open" : macro.virtueGate?.status;
  const verdict = blend(eth.seykota, macro.regime, gate);
  const dir = direction(verdict);
  const signal = {
    asset: "ETH",
    seykota: { signal: eth.seykota, detail: eth.seykotaDetail, ema12: eth.ema12, ema26: eth.ema26 },
    druckenmiller: { regime: macro.regime, regimeScore: macro.regimeScore },
    verdict,
    direction: dir,
    virtueGate: input.taker ? macro.virtueGate : { status: "not checked (no taker given)" },
    priceUsd: eth.last,
    updatedAt: macro.updatedAt,
  };
  if (dir === "none") return { signal, quote: null, note: "No trade: signal is neutral or conflicted." };

  const sell =
    dir === "long"
      ? { sellToken: USDC_BASE, buyToken: WETH_BASE, sellAmount: String(Math.round(input.amountUsd * 1e6)) }
      : {
          sellToken: WETH_BASE,
          buyToken: USDC_BASE,
          sellAmount: (BigInt(Math.round((input.amountUsd / eth.last) * 1e9)) * 10n ** 9n).toString(),
        };
  const p = zeroxParams({ chainId: String(BASE_CHAIN_ID), ...sell, taker: input.taker || "" }, env);
  if (p.error) throw new Error(p.error);
  const key = zeroxKey(env);
  if (!key) throw new Error("ZEROX_API_KEY not set");
  const r = await fetchImpl(`${ZEROX_QUOTE}?${p.query}`, {
    headers: { "0x-api-key": key, "0x-version": "v2", Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const q = await r.json().catch(() => ({}));
  if (!r.ok || !q.buyAmount) throw new Error(`0x quote failed (${r.status})`);
  return {
    signal,
    quote: {
      source: "0x",
      chainId: BASE_CHAIN_ID,
      side: dir === "long" ? "buy ETH with USDC" : "sell ETH for USDC",
      sellToken: sell.sellToken,
      buyToken: sell.buyToken,
      sellAmount: q.sellAmount || sell.sellAmount,
      buyAmount: q.buyAmount,
      minBuyAmount: q.minBuyAmount ?? null,
      allowanceTarget: q.issues?.allowance?.spender ?? q.allowanceTarget ?? null,
      // Unsigned transaction for the taker's own wallet; only usable when a taker was given.
      transaction: input.taker ? (q.transaction ?? null) : null,
    },
  };
}

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

/** Facilitator client. Returns null when no facilitator is configured. */
export function createFacilitator({ env = process.env, fetchImpl = fetch, authHeaders = cdpAuthHeaders } = {}) {
  const cfg = agentConfig(env);
  const useCdp = !cfg.facilitatorUrl && env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET;
  const base = cfg.facilitatorUrl || (useCdp ? CDP_FACILITATOR : null);
  if (!base) return null;
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
    verify: (p, req) => call("verify", p, req),
    settle: (p, req) => call("settle", p, req),
  };
}

/** Express handlers: { info, job, card }. */
export function createAgentJob({ env = process.env, facilitator, getMacro, blend, fetchImpl = fetch } = {}) {
  const cfg = agentConfig(env);
  const fac = facilitator === undefined ? createFacilitator({ env, fetchImpl }) : facilitator;
  const reqs = paymentRequirements(cfg);
  const need = (res, error) => res.status(402).json({ x402Version: 1, error, accepts: [reqs] });

  return {
    enabled: Boolean(fac),
    info(_req, res) {
      res.json({
        agent: AGENT_NAME,
        method: "POST",
        body: { asset: "ETH", amountUsd: "1-10000 (default 100)", taker: "0x… (optional; adds a signable tx)" },
        payments: fac ? "enabled" : "not configured",
        accepts: [reqs],
      });
    },
    async job(req, res) {
      const parsed = parseJob(req.body || {});
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (!fac) return res.status(503).json({ error: "payments not configured on this server", accepts: [reqs] });

      const header = req.get?.("X-PAYMENT") ?? req.headers?.["x-payment"];
      if (!header) return need(res, "X-PAYMENT header is required");
      let payload;
      try {
        payload = b64json(header);
      } catch {
        return need(res, "X-PAYMENT is not valid base64 JSON");
      }

      try {
        const v = await fac.verify(payload, reqs);
        if (!v.isValid) return need(res, `payment invalid: ${v.invalidReason || "unknown"}`);
      } catch (e) {
        return res.status(502).json({ error: String(e.message).slice(0, 200) });
      }

      let result;
      try {
        result = await runJob(parsed.input, { getMacro, blend, fetchImpl, env });
      } catch (e) {
        // Not settled -> the payer is not charged.
        return res.status(502).json({ error: String(e.message).slice(0, 200), charged: false });
      }

      let s;
      try {
        s = await fac.settle(payload, reqs);
      } catch (e) {
        return need(res, String(e.message).slice(0, 200));
      }
      if (!s.success) return need(res, `settlement failed: ${s.errorReason || "unknown"}`);

      res.set(
        "X-PAYMENT-RESPONSE",
        tob64({ success: true, transaction: s.transaction, network: s.network || "base", payer: s.payer }),
      );
      res.json({ agent: AGENT_NAME, ...result, payment: { transaction: s.transaction, payer: s.payer } });
    },
    card(_req, res) {
      res.json(registrationFile(cfg));
    },
  };
}
