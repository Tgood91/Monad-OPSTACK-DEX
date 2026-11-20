import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  checkRequirements,
  buildAuthorization,
  typedData,
  paymentHeader,
  describeResult,
  fmtUnits,
} from "../src/agent-core.js";
import { agentConfig, paymentRequirements } from "../server/agent-job.js";

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

test("authorization pays exactly the price to payTo inside the time window", () => {
  const a = buildAuthorization({
    from: "0x000000000000000000000000000000000000bEEF",
    req: REQ,
    now: 1000,
    nonce: "0x" + "11".repeat(32),
  });
  assert.equal(a.to, REQ.payTo);
  assert.equal(a.value, "10000");
  assert.equal(a.validAfter, "400");
  assert.equal(a.validBefore, "1120");
});

test("a real EIP-712 signature over the typed data recovers to the payer, and the header decodes", async () => {
  const w = ethers.Wallet.createRandom();
  const auth = buildAuthorization({
    from: w.address,
    req: REQ,
    now: 1_700_000_000,
    nonce: ethers.hexlify(ethers.randomBytes(32)),
  });
  const td = typedData(REQ, auth);
  assert.deepEqual(td.domain, {
    name: "USD Coin",
    version: "2",
    chainId: 8453,
    verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  });
  const sig = await w.signTypedData(td.domain, td.types, td.message);
  assert.equal(ethers.verifyTypedData(td.domain, td.types, td.message, sig), w.address);
  const decoded = JSON.parse(Buffer.from(paymentHeader(REQ, auth, sig), "base64").toString());
  assert.equal(decoded.x402Version, 1);
  assert.equal(decoded.network, "base");
  assert.equal(decoded.payload.signature, sig);
  assert.deepEqual(decoded.payload.authorization, auth);
});

test("fmtUnits", () => {
  assert.equal(fmtUnits("10000", 6), "0.01");
  assert.equal(fmtUnits("100000000000000000", 18), "0.1");
  assert.equal(fmtUnits("5000000", 6), "5");
  assert.equal(fmtUnits(null, 6), "—");
});

test("a short result shows the quote and prefills ETH -> USDC in the Swap tab", () => {
  const v = describeResult({
    signal: {
      verdict: "CONFIRMED SHORT",
      direction: "short",
      priceUsd: 1605,
      druckenmiller: { regime: "RISK-OFF", regimeScore: -5 },
      seykota: { signal: "HOLD_SHORT", detail: "downtrend intact" },
      virtueGate: { status: "unknown" },
    },
    quote: {
      source: "0x",
      side: "sell ETH for USDC",
      sellToken: "0x4200000000000000000000000000000000000006",
      buyToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      sellAmount: "62000000000000000",
      buyAmount: "99500000",
      minBuyAmount: "99000000",
    },
    payment: { transaction: "0xabc" },
  });
  assert.equal(v.tone, "error");
  assert.equal(v.quote.sell, "0.062 ETH");
  assert.equal(v.quote.buy, "99.5 USDC");
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
