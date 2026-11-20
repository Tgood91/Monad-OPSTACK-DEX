import test from "node:test";
import assert from "node:assert/strict";
import {
  agentConfig,
  paymentRequirements,
  registrationFile,
  parseJob,
  direction,
  runJob,
  bestQuote,
  defaultSources,
  createAgentJob,
  createFacilitator,
  USDC_BASE,
  WETH_BASE,
  DEFAULT_PAY_TO,
  CDP_FACILITATOR,
} from "../server/agent-job.js";
import { blend } from "../server/macro.js";

const TAKER = "0x000000000000000000000000000000000000bEEF";

function macro({ seykota = "BUY", regime = "RISK-ON", gate = "unknown", last = 3000 } = {}) {
  return async () => ({
    regime,
    regimeScore: regime === "RISK-ON" ? 4 : regime === "RISK-OFF" ? -4 : 0,
    updatedAt: "2026-11-20T00:00:00Z",
    virtueGate: { status: gate },
    marketsAvailable: 5,
    marketsTotal: 5,
    factors: [
      { id: "eth", available: true, source: "GeckoTerminal", seykota, seykotaDetail: "x", ema12: 1, ema26: 1, last },
    ],
  });
}

// Fake sources: each records the trade it was asked for and answers a fixed amount (or fails).
function fakeSources(amounts, calls = []) {
  return Object.fromEntries(
    Object.entries(amounts).map(([name, amt]) => [
      name,
      async (t) => {
        calls.push({ name, ...t });
        if (amt instanceof Error) throw amt;
        return { buyAmount: String(amt), minBuyAmount: String(amt - 1), transaction: { to: "0x0b0b", data: "0x" } };
      },
    ]),
  );
}
const SOURCES = () => fakeSources({ "0x": 120, "1inch": 125, uniswap: new Error("needs a wallet"), zerion: 119 });

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

const paymentFor = (nonce = "0x" + "ab".repeat(32)) =>
  Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: { signature: "0x", authorization: { from: TAKER, nonce } },
    }),
  ).toString("base64");
const PAYMENT = paymentFor();

function facilitator({ valid = true, settled = true, log = [], verifyError = null, slowVerify = 0 } = {}) {
  return {
    kind: "test",
    status: async () => ({ ready: true }),
    verify: async () => {
      log.push("verify");
      if (slowVerify) await new Promise((r) => setTimeout(r, slowVerify));
      if (verifyError) throw verifyError;
      return { isValid: valid, invalidReason: valid ? null : "bad_sig" };
    },
    settle: async () => (
      log.push("settle"),
      settled ? { success: true, transaction: "0xabc", payer: TAKER } : { success: false, errorReason: "nonce_used" }
    ),
  };
}

const agent = (over = {}) =>
  createAgentJob({ env: {}, facilitator: facilitator(), getMacro: macro(), blend, sources: SOURCES(), ...over });

test("config: 0.01 USDC to the owner's wallet by default; requirements match x402 exact on Base", () => {
  const cfg = agentConfig({});
  assert.equal(cfg.atomic, "10000");
  assert.equal(cfg.payTo, DEFAULT_PAY_TO);
  const r = paymentRequirements(cfg);
  assert.equal(r.network, "base");
  assert.equal(r.asset, USDC_BASE);
  assert.equal(r.maxAmountRequired, "10000");
  assert.equal(r.maxTimeoutSeconds, 300);
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
  assert.equal(registrationFile(agentConfig({ AGENT_ID: "42" })).registrations[0].agentId, 42);
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

test("best quote: every source is asked at once; the highest wins; failures are listed, not hidden", async () => {
  const { best, answers } = await bestQuote({ sellToken: USDC_BASE }, SOURCES());
  assert.equal(best.source, "1inch");
  assert.equal(best.buyAmount, "125");
  assert.deepEqual(
    answers.map((a) => [a.source, a.error ?? a.buyAmount]),
    [
      ["0x", "120"],
      ["1inch", "125"],
      ["uniswap", "needs a wallet"],
      ["zerion", "119"],
    ],
  );
  const slow = { a: () => new Promise(() => {}), b: async () => ({ buyAmount: "5" }) };
  const r = await bestQuote({}, slow, 30);
  assert.equal(r.best.source, "b");
  assert.equal(r.answers[0].error, "timed out");
});

test("long signal sells the dollar amount of USDC for WETH, asking every source", async () => {
  const calls = [];
  const r = await runJob(
    { asset: "ETH", amountUsd: 50, taker: TAKER },
    { getMacro: macro(), blend, sources: fakeSources({ "0x": 10, "1inch": 9 }, calls) },
  );
  assert.equal(r.signal.direction, "long");
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.sellToken, USDC_BASE);
    assert.equal(c.buyToken, WETH_BASE);
    assert.equal(c.sellAmount, "50000000");
    assert.equal(c.taker, TAKER);
  }
  assert.equal(r.quote.source, "0x");
  assert.ok(r.quote.transaction);
  assert.equal(r.quote.sources.length, 2);
});

test("short signal sells ETH worth the dollar amount; no taker means no transaction", async () => {
  const calls = [];
  const r = await runJob(
    { asset: "ETH", amountUsd: 300, taker: null },
    {
      getMacro: macro({ seykota: "SELL", regime: "RISK-OFF", last: 3000 }),
      blend,
      sources: fakeSources({ "0x": 7 }, calls),
    },
  );
  assert.equal(r.signal.direction, "short");
  assert.equal(calls[0].sellToken, WETH_BASE);
  assert.equal(calls[0].sellAmount, "100000000000000000"); // 0.1 ETH
  assert.equal(r.quote.transaction, null);
});

test("neutral or conflicted signal returns no quote and asks no source", async () => {
  const calls = [];
  const r = await runJob(
    { asset: "ETH", amountUsd: 100, taker: null },
    { getMacro: macro({ regime: "RISK-OFF" }), blend, sources: fakeSources({ "0x": 1 }, calls) },
  );
  assert.equal(r.quote, null);
  assert.equal(calls.length, 0);
});

test("no quote from any source fails the job", async () => {
  await assert.rejects(
    runJob(
      { asset: "ETH", amountUsd: 100, taker: null },
      { getMacro: macro(), blend, sources: fakeSources({ "0x": new Error("x") }) },
    ),
    /no quote from any source/,
  );
});

test("real sources: Uniswap and Zerion are skipped without a wallet; 0x says when its key is missing", async () => {
  const s = defaultSources({ env: {} });
  await assert.rejects(s.uniswap({ sellToken: USDC_BASE, buyToken: WETH_BASE, sellAmount: "1" }), /needs a wallet/);
  await assert.rejects(s.zerion({ sellToken: USDC_BASE, buyToken: WETH_BASE, sellAmount: "1" }), /needs a wallet/);
  await assert.rejects(s["0x"]({ sellToken: USDC_BASE, buyToken: WETH_BASE, sellAmount: "1" }), /not set up/);
});

test("no facilitator: 503 and nothing charged; info says payments are off", async () => {
  const a = agent({ facilitator: null });
  assert.equal(a.enabled, false);
  assert.equal((await call(a.job, { body: {} })).code, 503);
  const info = await call(a.info);
  assert.equal(info.body.payments, "off");
  assert.equal(info.body.agent.name, "Bushido-Trades");
});

test("info: hiring pauses before anyone signs when the market data a job needs is missing", async () => {
  const a = agent({ marketReady: async () => ({ ready: false, reason: "Market data is unavailable right now." }) });
  const info = await call(a.info);
  assert.equal(info.body.payments, "paused");
  assert.equal(info.body.note, "Market data is unavailable right now.");
});

test("job result names the regime, its source and how many markets were read", async () => {
  const r = await runJob(
    { asset: "ETH", amountUsd: 50, taker: null },
    { getMacro: macro(), blend, sources: SOURCES() },
  );
  assert.deepEqual(r.signal.regime, { state: "RISK-ON", score: 4, markets: 5, of: 5, source: "GeckoTerminal" });
  assert.equal(r.signal.seykota.source, "GeckoTerminal");
});

test("info: payments enabled, or paused with the reason when the gas wallet is empty", async () => {
  assert.equal((await call(agent().info)).body.payments, "enabled");
  const paused = agent({
    facilitator: { ...facilitator(), status: async () => ({ ready: false, reason: "out of gas" }) },
  });
  const info = await call(paused.info);
  assert.equal(info.body.payments, "paused");
  assert.equal(info.body.note, "out of gas");
});

test("no payment: 402 with x402 requirements; bad input: 400 before payment", async () => {
  const a = agent();
  const out = await call(a.job, { body: {} });
  assert.equal(out.code, 402);
  assert.equal(out.body.x402Version, 1);
  assert.equal(out.body.accepts[0].maxAmountRequired, "10000");
  assert.equal((await call(a.job, { body: { amountUsd: -1 } })).code, 400);
  assert.equal((await call(a.job, { body: {}, headers: { "X-PAYMENT": "%%%" } })).code, 402);
});

test("paid job: verify, run, settle, then 200 with X-PAYMENT-RESPONSE", async () => {
  const log = [];
  const a = agent({ facilitator: facilitator({ log }) });
  const out = await call(a.job, { body: { taker: TAKER }, headers: { "X-PAYMENT": PAYMENT } });
  assert.equal(out.code, 200);
  assert.deepEqual(log, ["verify", "settle"]);
  assert.equal(out.body.payment.transaction, "0xabc");
  assert.equal(out.body.quote.source, "1inch");
  const pr = JSON.parse(Buffer.from(out.headers["X-PAYMENT-RESPONSE"], "base64").toString());
  assert.equal(pr.transaction, "0xabc");
});

test("the same payment sent twice at once: the second is refused while the first runs", async () => {
  const a = agent({ facilitator: facilitator({ slowVerify: 30 }) });
  const [first, second] = await Promise.all([
    call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } }),
    call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } }),
  ]);
  assert.equal(first.code, 200);
  assert.equal(second.code, 409);
  // Once finished, the key is released (a later reuse is refused on-chain by the facilitator instead).
  assert.equal((await call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } })).code, 200);
});

test("invalid payment is rejected and the job never runs", async () => {
  const log = [];
  const calls = [];
  const a = agent({ facilitator: facilitator({ valid: false, log }), sources: fakeSources({ "0x": 1 }, calls) });
  const out = await call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } });
  assert.equal(out.code, 402);
  assert.deepEqual(log, ["verify"]);
  assert.equal(calls.length, 0);
});

test("a paused settler (empty gas wallet) answers 503 before the job runs", async () => {
  const calls = [];
  const err = Object.assign(new Error("gas wallet is out of ETH"), { status: 503 });
  const a = agent({ facilitator: facilitator({ verifyError: err }), sources: fakeSources({ "0x": 1 }, calls) });
  const out = await call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } });
  assert.equal(out.code, 503);
  assert.equal(out.body.charged, false);
  assert.equal(calls.length, 0);
});

test("a failed job is not settled (payer not charged)", async () => {
  const log = [];
  const a = agent({ facilitator: facilitator({ log }), sources: fakeSources({ "0x": new Error("down") }) });
  const out = await call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } });
  assert.equal(out.code, 502);
  assert.equal(out.body.charged, false);
  assert.deepEqual(log, ["verify"]);
});

test("settlement failure returns 402 and no result", async () => {
  const a = agent({ facilitator: facilitator({ settled: false }) });
  const out = await call(a.job, { body: {}, headers: { "X-PAYMENT": PAYMENT } });
  assert.equal(out.code, 402);
  assert.equal(out.body.signal, undefined);
});

test("facilitator order: a custom URL, then CDP (signed), then the server's own burner; none without any", async () => {
  assert.equal(createFacilitator({ env: {} }), null);
  const seen = [];
  const fetchImpl = async (url, init) => (
    seen.push({ url, init }),
    { ok: true, json: async () => ({ isValid: true }) }
  );
  const cdp = createFacilitator({
    env: { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "s", FAUCET_PRIVATE_KEY: "0x" + "11".repeat(32) },
    fetchImpl,
    authHeaders: async () => ({ Authorization: "Bearer t" }),
  });
  assert.equal(cdp.kind, "cdp");
  await cdp.verify({}, {});
  assert.equal(seen[0].url, `${CDP_FACILITATOR}/verify`);
  assert.equal(seen[0].init.headers.Authorization, "Bearer t");
  const custom = createFacilitator({
    env: { X402_FACILITATOR_URL: "https://f.example/", CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "s" },
    fetchImpl,
  });
  assert.equal(custom.kind, "custom");
  await custom.settle({}, {});
  assert.equal(seen[1].url, "https://f.example/settle");
  assert.equal(seen[1].init.headers.Authorization, undefined);
  let built = null;
  const self = createFacilitator({
    env: { FAUCET_PRIVATE_KEY: "0x" + "11".repeat(32), BASE_RPC: "https://rpc.example" },
    chainFactory: (o) => ((built = o), { address: "0x00000000000000000000000000000000000000Aa" }),
  });
  assert.equal(self.kind, "self");
  assert.equal(built.key, "0x" + "11".repeat(32));
  assert.equal(built.rpcs[0], "https://rpc.example");
  assert.equal(built.usdc, USDC_BASE);
});
