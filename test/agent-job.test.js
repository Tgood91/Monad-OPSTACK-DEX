import test from "node:test";
import assert from "node:assert/strict";
import {
  agentConfig,
  paymentRequirements,
  registrationFile,
  parseJob,
  direction,
  runJob,
  createAgentJob,
  createFacilitator,
  USDC_BASE,
  WETH_BASE,
  DEFAULT_PAY_TO,
  CDP_FACILITATOR,
} from "../server/agent-job.js";
import { blend } from "../server/macro.js";

const ENV = { ZEROX_API_KEY: "k", FEE_BPS: "0" };
const TAKER = "0x000000000000000000000000000000000000bEEF";

function macro({ seykota = "BUY", regime = "RISK-ON", gate = "unknown", last = 3000 } = {}) {
  return async () => ({
    regime,
    regimeScore: regime === "RISK-ON" ? 4 : regime === "RISK-OFF" ? -4 : 0,
    updatedAt: "2026-11-20T00:00:00Z",
    virtueGate: { status: gate },
    factors: [{ id: "eth", available: true, seykota, seykotaDetail: "x", ema12: 1, ema26: 1, last }],
  });
}

function fakeZerox(calls) {
  return async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        sellAmount: new URL(url).searchParams.get("sellAmount"),
        buyAmount: "123",
        minBuyAmount: "120",
        issues: { allowance: { spender: "0x0000000000000000000000000000000000000a11" } },
        transaction: { to: "0x0000000000000000000000000000000000000b0b", data: "0x", value: "0" },
      }),
    };
  };
}

function call(handler, { body = {}, headers = {} } = {}) {
  return new Promise((resolve) => {
    const out = { code: 200, headers: {} };
    const res = {
      status(c) {
        out.code = c;
        return this;
      },
      set(k, v) {
        out.headers[k] = v;
        return this;
      },
      json(b) {
        out.body = b;
        resolve(out);
      },
    };
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    handler({ body, headers: lower, get: (k) => lower[k.toLowerCase()] }, res);
  });
}

const PAYMENT = Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network: "base", payload: {} })).toString(
  "base64",
);

function facilitator({ valid = true, settled = true, log = [] } = {}) {
  return {
    verify: async () => (log.push("verify"), { isValid: valid, invalidReason: valid ? null : "bad_sig" }),
    settle: async () => (
      log.push("settle"),
      settled ? { success: true, transaction: "0xabc", payer: TAKER } : { success: false, errorReason: "nonce_used" }
    ),
  };
}

test("config: 0.01 USDC to the owner's wallet by default; requirements match x402 exact on Base", () => {
  const cfg = agentConfig({});
  assert.equal(cfg.atomic, "10000");
  assert.equal(cfg.payTo, DEFAULT_PAY_TO);
  const r = paymentRequirements(cfg);
  assert.equal(r.network, "base");
  assert.equal(r.asset, USDC_BASE);
  assert.equal(r.maxAmountRequired, "10000");
  assert.deepEqual(r.extra, { name: "USD Coin", version: "2" });
  assert.equal(r.resource, "https://bushido-dapp.onrender.com/api/agent/job");
  assert.equal(agentConfig({ AGENT_PAY_TO: "nope" }).payTo, DEFAULT_PAY_TO);
});

test("registration file carries the endpoint, price and (once set) the agentId", () => {
  const f = registrationFile(agentConfig({}));
  assert.equal(f.name, "Bushido-Trades");
  assert.equal(f.services[0].endpoint, "https://bushido-dapp.onrender.com/api/agent/job");
  assert.equal(f.pricing.amount, "0.01");
  assert.deepEqual(f.registrations, []);
  const g = registrationFile(agentConfig({ AGENT_ID: "42" }));
  assert.equal(g.registrations[0].agentId, 42);
});

test("job input is validated", () => {
  assert.deepEqual(parseJob({}).input, { asset: "ETH", amountUsd: 100, taker: null });
  assert.ok(parseJob({ asset: "BTC" }).error);
  assert.ok(parseJob({ amountUsd: 0 }).error);
  assert.ok(parseJob({ amountUsd: 20000 }).error);
  assert.ok(parseJob({ taker: "0x12" }).error);
});

test("direction comes from the blended Seykota x macro verdict", () => {
  assert.equal(direction(blend("BUY", "RISK-ON", "open")), "long");
  assert.equal(direction(blend("HOLD_LONG", "NEUTRAL", "open")), "long");
  assert.equal(direction(blend("SELL", "RISK-OFF", "open")), "short");
  assert.equal(direction(blend("BUY", "RISK-OFF", "open")), "none");
  assert.equal(direction(blend("BUY", "RISK-ON", "closed")), "none");
});

test("long signal quotes USDC -> WETH for the dollar amount", async () => {
  const calls = [];
  const r = await runJob(
    { asset: "ETH", amountUsd: 50, taker: TAKER },
    { getMacro: macro(), blend, fetchImpl: fakeZerox(calls), env: ENV },
  );
  assert.equal(r.signal.direction, "long");
  const q = new URL(calls[0]).searchParams;
  assert.equal(q.get("chainId"), "8453");
  assert.equal(q.get("sellToken"), USDC_BASE);
  assert.equal(q.get("buyToken"), WETH_BASE);
  assert.equal(q.get("sellAmount"), "50000000");
  assert.equal(q.get("taker"), TAKER);
  assert.ok(r.quote.transaction);
});

test("short signal sells ETH worth the dollar amount; no taker means no transaction", async () => {
  const calls = [];
  const r = await runJob(
    { asset: "ETH", amountUsd: 300, taker: null },
    {
      getMacro: macro({ seykota: "SELL", regime: "RISK-OFF", last: 3000 }),
      blend,
      fetchImpl: fakeZerox(calls),
      env: ENV,
    },
  );
  assert.equal(r.signal.direction, "short");
  const q = new URL(calls[0]).searchParams;
  assert.equal(q.get("sellToken"), WETH_BASE);
  assert.equal(q.get("sellAmount"), "100000000000000000"); // 0.1 ETH
  assert.equal(r.quote.transaction, null);
});

test("neutral or conflicted signal returns no quote and makes no 0x call", async () => {
  const calls = [];
  const r = await runJob(
    { asset: "ETH", amountUsd: 100, taker: null },
    { getMacro: macro({ regime: "RISK-OFF" }), blend, fetchImpl: fakeZerox(calls), env: ENV },
  );
  assert.equal(r.quote, null);
  assert.equal(calls.length, 0);
});

test("no facilitator: 503 and nothing charged", async () => {
  const a = createAgentJob({ env: ENV, facilitator: null, getMacro: macro(), blend, fetchImpl: fakeZerox([]) });
  assert.equal(a.enabled, false);
  const out = await call(a.job, { body: {} });
  assert.equal(out.code, 503);
});

test("no payment: 402 with x402 requirements; bad input: 400 before payment", async () => {
  const a = createAgentJob({
    env: ENV,
    facilitator: facilitator(),
    getMacro: macro(),
    blend,
    fetchImpl: fakeZerox([]),
  });
  const out = await call(a.job, { body: {} });
  assert.equal(out.code, 402);
  assert.equal(out.body.x402Version, 1);
  assert.equal(out.body.accepts[0].maxAmountRequired, "10000");
  assert.equal((await call(a.job, { body: { amountUsd: -1 } })).code, 400);
  assert.equal((await call(a.job, { body: {}, headers: { "X-PAYMENT": "%%%" } })).code, 402);
});

test("paid job: verify, run, settle, then 200 with X-PAYMENT-RESPONSE", async () => {
  const log = [];
  const a = createAgentJob({
    env: ENV,
    facilitator: facilitator({ log }),
    getMacro: macro(),
    blend,
    fetchImpl: fakeZerox([]),
  });
  const out = await call(a.job, { body: { taker: TAKER }, headers: { "X-PAYMENT": PAYMENT } });
  assert.equal(out.code, 200);
  assert.deepEqual(log, ["verify", "settle"]);
  assert.equal(out.body.payment.transaction, "0xabc");
  const pr = JSON.parse(Buffer.from(out.headers["X-PAYMENT-RESPONSE"], "base64").toString());
  assert.equal(pr.transaction, "0xabc");
});

test("invalid payment is rejected and the job never runs", async () => {
  const log = [];
  const calls = [];
  const a = createAgentJob({
    env: ENV,
    facilitator: facilitator({ valid: false, log }),
    getMacro: macro(),
    blend,
    fetchImpl: fakeZerox(calls),
  });
  const out = await call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } });
  assert.equal(out.code, 402);
  assert.deepEqual(log, ["verify"]);
  assert.equal(calls.length, 0);
});

test("a failed job is not settled (payer not charged)", async () => {
  const log = [];
  const broken = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const a = createAgentJob({
    env: ENV,
    facilitator: facilitator({ log }),
    getMacro: macro(),
    blend,
    fetchImpl: broken,
  });
  const out = await call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } });
  assert.equal(out.code, 502);
  assert.equal(out.body.charged, false);
  assert.deepEqual(log, ["verify"]);
});

test("settlement failure returns 402 and no result", async () => {
  const a = createAgentJob({
    env: ENV,
    facilitator: facilitator({ settled: false }),
    getMacro: macro(),
    blend,
    fetchImpl: fakeZerox([]),
  });
  const out = await call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } });
  assert.equal(out.code, 402);
  assert.equal(out.body.signal, undefined);
});

test("facilitator: CDP when CDP keys are set (signed), custom URL overrides, none otherwise", async () => {
  assert.equal(createFacilitator({ env: {} }), null);
  const seen = [];
  const fetchImpl = async (url, init) => (
    seen.push({ url, init }),
    { ok: true, json: async () => ({ isValid: true }) }
  );
  const cdp = createFacilitator({
    env: { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "s" },
    fetchImpl,
    authHeaders: async () => ({ Authorization: "Bearer t" }),
  });
  assert.equal(cdp.kind, "cdp");
  await cdp.verify({}, {});
  assert.equal(seen[0].url, `${CDP_FACILITATOR}/verify`);
  assert.equal(seen[0].init.headers.Authorization, "Bearer t");
  const custom = createFacilitator({ env: { X402_FACILITATOR_URL: "https://f.example/" }, fetchImpl });
  assert.equal(custom.kind, "custom");
  await custom.settle({}, {});
  assert.equal(seen[1].url, "https://f.example/settle");
  assert.equal(seen[1].init.headers.Authorization, undefined);
});
