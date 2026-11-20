import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  checkRequirements,
  buildAuthorization,
  typedData,
  paymentHeader,
  describeResult,
  describeStatus,
  greeting,
  fmtUnits,
} from "../src/agent-core.js";
import { agentConfig, paymentRequirements } from "../server/agent-job.js";
import { parsePayment, createLocalFacilitator } from "../server/x402-local.js";

// The tab signs exactly what the server asks for, so test against the server's own requirements.
const REQ = paymentRequirements(agentConfig({}));

test("the server's requirements pass; anything odd or over 1 USDC is refused", () => {
  assert.equal(checkRequirements(REQ), null);
  assert.ok(checkRequirements(null));
  assert.ok(checkRequirements({ ...REQ, network: "base-sepolia" }));
  assert.ok(checkRequirements({ ...REQ, scheme: "upto" }));
  assert.ok(checkRequirements({ ...REQ, payTo: "0x12" }));
  assert.ok(checkRequirements({ ...REQ, maxAmountRequired: "0" }));
  assert.match(checkRequirements({ ...REQ, maxAmountRequired: "1000001" }), /more than 1 USDC/);
});

test("authorization pays exactly the price to payTo inside the server's time window", () => {
  const a = buildAuthorization({
    from: "0x000000000000000000000000000000000000bEEF",
    req: REQ,
    now: 1000,
    nonce: "0x" + "11".repeat(32),
  });
  assert.equal(a.to, REQ.payTo);
  assert.equal(a.value, "10000");
  assert.equal(a.validAfter, "400");
  assert.equal(a.validBefore, "1300");
});

test("what the tab signs is what the server's settler accepts (real signature, end to end)", async () => {
  const w = ethers.Wallet.createRandom();
  const now = Math.floor(Date.now() / 1000);
  const auth = buildAuthorization({ from: w.address, req: REQ, now, nonce: ethers.hexlify(ethers.randomBytes(32)) });
  const td = typedData(REQ, auth);
  assert.deepEqual(td.domain, {
    name: "USD Coin",
    version: "2",
    chainId: 8453,
    verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  });
  const sig = await w.signTypedData(td.domain, td.types, td.message);
  const payload = JSON.parse(Buffer.from(paymentHeader(REQ, auth, sig), "base64").toString());
  assert.ok(parsePayment(payload, REQ, now).args);
  const chain = {
    address: "0x00000000000000000000000000000000000000Aa",
    balanceOf: async () => 10n ** 6n,
    authorizationUsed: async () => false,
    gasBalance: async () => 10n ** 15n,
    feePerGas: async () => 10n ** 7n,
    simulate: async () => "0x",
    estimateGas: async () => 87_000n,
  };
  const v = await createLocalFacilitator({ chain }).verify(payload, REQ);
  assert.deepEqual(v, { isValid: true, payer: w.address });
});

test("fmtUnits", () => {
  assert.equal(fmtUnits("10000", 6), "0.01");
  assert.equal(fmtUnits("100000000000000000", 18), "0.1");
  assert.equal(fmtUnits("5000000", 6), "5");
  assert.equal(fmtUnits(null, 6), "—");
});

test("status: taking jobs, paused with the server's reason, off, or offline", () => {
  const base = { accepts: [REQ] };
  assert.deepEqual(describeStatus({ ...base, payments: "enabled" }), {
    canHire: true,
    tone: "success",
    chip: "Taking jobs",
    text: "",
    price: "0.01",
  });
  const paused = describeStatus({ ...base, payments: "paused", note: "gas wallet empty" });
  assert.equal(paused.canHire, false);
  assert.equal(paused.text, "gas wallet empty");
  assert.equal(describeStatus({ ...base, payments: "off" }).chip, "Off");
  assert.equal(describeStatus(null).chip, "Offline");
});

test("greeting is built from what the server says (price and sources)", () => {
  const g = greeting({
    accepts: [REQ],
    agent: { name: "Bushido-Trades", sources: ["0x", "1inch", "uniswap", "zerion"] },
  });
  assert.match(g, /0\.01 USDC/);
  assert.match(g, /across 0x, 1inch, Uniswap, Zerion/);
});

test("a short result shows the best quote, every source best first, and prefills ETH -> USDC in Swap", () => {
  const v = describeResult({
    signal: {
      verdict: "CONFIRMED SHORT",
      direction: "short",
      priceUsd: 1605,
      druckenmiller: { regime: "RISK-OFF", regimeScore: -5 },
      seykota: { signal: "HOLD_SHORT", detail: "downtrend intact" },
      virtueGate: { status: "not checked" },
    },
    quote: {
      source: "1inch",
      side: "sell ETH for USDC",
      sellToken: "0x4200000000000000000000000000000000000006",
      buyToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      sellAmount: "62000000000000000",
      buyAmount: "99500000",
      minBuyAmount: "99000000",
      sources: [
        { source: "0x", buyAmount: "99400000" },
        { source: "uniswap", error: "timed out" },
        { source: "1inch", buyAmount: "99500000" },
      ],
    },
    payment: { transaction: "0xabc" },
  });
  assert.equal(v.tone, "error");
  assert.equal(v.quote.source, "1inch");
  assert.equal(v.quote.sell, "0.062 ETH");
  assert.equal(v.quote.buy, "99.5 USDC");
  assert.deepEqual(
    v.quote.sources.map((s) => [s.name, s.text]),
    [
      ["1inch", "99.5 USDC"],
      ["0x", "99.4 USDC"],
      ["Uniswap", "timed out"],
    ],
  );
  assert.deepEqual(v.prefill, { chainKey: "base", from: "ETH", to: "USDC", amount: "0.062" });
  assert.equal(v.paymentTx, "0xabc");
});

test("no trade: no quote and no prefill", () => {
  const v = describeResult({
    signal: { verdict: "CONFLICT — trend vs macro", direction: "none" },
    quote: null,
    note: "No trade.",
  });
  assert.equal(v.quote, null);
  assert.equal(v.prefill, null);
  assert.equal(v.tone, "warn");
});

test("result bubble escapes every value it shows", async () => {
  const { resultHtml } = await import("../src/agent-core.js");
  const html = resultHtml({
    verdict: "<img src=x onerror=alert(1)>",
    tone: "warn",
    price: "$1",
    regime: "R",
    seykota: "S",
    gate: "g",
    quote: null,
    note: "<b>no</b>",
    paymentTx: '0x"><script>',
  });
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<b>no</b>"));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;img/);
});
