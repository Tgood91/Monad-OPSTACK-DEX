import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyIntent,
  checkWithNear,
  whyPayFirst,
  depositView,
  chunkAddress,
  shortAddr,
  formatUnits,
  hoursLeft,
  NEAR_STATUS_URL,
} from "../src/bridge-deposit.js";
import { normalizeQuote } from "../server/near.js";

const WALLET = "0xBA397fAae1D5Fe10C0356f2e585bef34577ab111";
const DEPOSIT = "0xB629DA4E405F813e3577be4829E9C079Fc62bad7";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NOW = Date.parse("2026-11-07T22:10:00Z");

// The shape NEAR's status service returned for a real intent (Base USDC -> Avalanche AVAX).
const record = (over = {}) => ({
  status: "PENDING_DEPOSIT",
  quoteResponse: {
    quoteRequest: {
      dry: false,
      swapType: "EXACT_INPUT",
      depositType: "ORIGIN_CHAIN",
      refundType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
      destinationAsset: "nep245:v2_1.omni.hot.tg:43114_11111111111111111111",
      amount: "280000",
      refundTo: WALLET,
      recipient: WALLET,
      deadline: "2026-11-08T22:09:48.925Z",
      appFees: [{ recipient: "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", fee: 20 }],
    },
    quote: { depositAddress: DEPOSIT, deadline: "2026-11-11T22:09:48.925Z" },
    ...over,
  },
});
const expected = (over = {}) => ({
  depositAddress: DEPOSIT,
  wallet: WALLET,
  amountAtomic: "280000",
  fromTokenAddress: USDC,
  ...over,
});
const withReq = (patch) => {
  const r = record();
  Object.assign(r.quoteResponse.quoteRequest, patch);
  return r;
};

test("a record that matches what the user chose passes, and reports NEAR's fee", () => {
  const v = verifyIntent(record(), expected(), NOW);
  assert.equal(v.ok, true);
  assert.deepEqual(v.problems, []);
  assert.equal(v.feeBps, 20);
});

test("address case does not matter (checksummed vs lowercase)", () => {
  assert.equal(
    verifyIntent(record(), expected({ wallet: WALLET.toLowerCase(), depositAddress: DEPOSIT.toLowerCase() }), NOW).ok,
    true,
  );
});

test("a wrong receiver or refund address is caught", () => {
  const evil = "0x1111111111111111111111111111111111111111";
  assert.match(verifyIntent(withReq({ recipient: evil }), expected(), NOW).problems.join(), /receiving address/);
  assert.match(verifyIntent(withReq({ refundTo: evil }), expected(), NOW).problems.join(), /refund address/);
});

test("a look-alike of your own address is NOT accepted", () => {
  const lookalike = "0xba391ee9e6034b6f50ade57cc6c823fd1c5ab111"; // starts and ends like the real one
  assert.equal(verifyIntent(withReq({ recipient: lookalike }), expected(), NOW).ok, false);
});

test("the address on screen must be the one NEAR issued", () => {
  const r = record();
  r.quoteResponse.quote.depositAddress = "0x2222222222222222222222222222222222222222";
  assert.match(verifyIntent(r, expected(), NOW).problems.join(), /not the one NEAR issued/);
});

test("amount, token, live quote and expiry are checked", () => {
  assert.match(verifyIntent(withReq({ amount: "1" }), expected(), NOW).problems.join(), /amount/);
  assert.match(verifyIntent(withReq({ dry: true }), expected(), NOW).problems.join(), /not a live quote/);
  assert.match(
    verifyIntent(withReq({ originAsset: "nep141:base-0xdeadbeef.omft.near" }), expected(), NOW).problems.join(),
    /token/,
  );
  assert.match(verifyIntent(withReq({ deadline: "2026-11-01T00:00:00Z" }), expected(), NOW).problems.join(), /expired/);
  assert.match(verifyIntent(withReq({ refundType: "INTENTS" }), expected(), NOW).problems.join(), /routing/);
});

test("a native-coin deposit has no token to compare", () => {
  assert.equal(
    verifyIntent(withReq({ originAsset: "nep141:eth.omft.near" }), expected({ fromTokenAddress: null }), NOW).ok,
    true,
  );
});

test("no record at all is a problem", () => {
  assert.equal(verifyIntent({}, expected(), NOW).ok, false);
  assert.equal(verifyIntent(null, expected(), NOW).ok, false);
});

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const noSleep = async () => {};

test("the check asks NEAR directly and is retried while the new address is not registered yet", async () => {
  const urls = [];
  let n = 0;
  const fetchImpl = async (u) => {
    urls.push(u);
    return ++n < 3 ? reply(404, {}) : reply(200, record());
  };
  const r = await checkWithNear(expected(), { fetchImpl, sleep: noSleep, nowMs: NOW });
  assert.equal(r.state, "verified");
  assert.equal(n, 3);
  assert.ok(
    urls.every((u) => u === NEAR_STATUS_URL + DEPOSIT),
    "must call NEAR itself, not our server",
  );
});

test("a mismatch is final: it is not retried", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    return reply(200, withReq({ recipient: "0x1111111111111111111111111111111111111111" }));
  };
  const r = await checkWithNear(expected(), { fetchImpl, sleep: noSleep, nowMs: NOW });
  assert.equal(r.state, "mismatch");
  assert.match(r.problems.join(), /receiving address/);
  assert.equal(n, 1);
});

test("if NEAR cannot be reached, the answer is 'unreachable', never 'verified'", async () => {
  const r = await checkWithNear(expected(), {
    fetchImpl: async () => {
      throw new Error("offline");
    },
    sleep: noSleep,
    tries: 3,
  });
  assert.equal(r.state, "unreachable");
  const r404 = await checkWithNear(expected(), { fetchImpl: async () => reply(404, {}), sleep: noSleep, tries: 2 });
  assert.equal(r404.state, "unreachable");
});

test("the 'why pay first' explanation names both chains and the gas coin", () => {
  const t = whyPayFirst({ fromLabel: "Base", toLabel: "Avalanche", gasSymbol: "ETH" });
  assert.match(t, /pay the amount to the bridge on Base/);
  assert.match(t, /pay you on Avalanche from their own funds/);
  assert.match(t, /little ETH for gas/);
  assert.match(t, /refunded to the same wallet/);
  assert.ok(t.length < 420, "short and brief");
});

const intent = () => ({
  amountInFormatted: "0.28",
  amountOutFormatted: "0.033420535123076857",
  minAmountOut: "33086329771846088",
  timeEstimateSec: 40,
  deadline: "2026-11-08T22:09:48.925Z",
  refundFee: "2400",
  depositAddress: DEPOSIT,
  fi: { symbol: "USDC", decimals: 6, address: USDC },
  ti: { symbol: "AVAX", decimals: 18, address: null },
});

test("the screen's wording: what you send, receive, where it goes, what happens on failure", () => {
  const v = depositView({
    intent: intent(),
    wallet: WALLET,
    fromChain: { label: "Base", native: "ETH" },
    toChain: { label: "Avalanche", native: "AVAX" },
    nowMs: NOW,
  });
  assert.equal(v.send, "0.28 USDC");
  assert.equal(v.sendChain, "Base");
  assert.match(v.receive, /^≈ 0\.033421 AVAX$/);
  assert.equal(v.receiveChain, "Avalanche");
  assert.match(v.min, /0\.033086 AVAX/);
  assert.equal(v.to, "0xBA39…b111");
  assert.equal(v.refund, "0xBA39…b111 on Base");
  assert.equal(v.refundFee, "about 0.0024 USDC");
  assert.equal(v.eta, "about 40 seconds");
  assert.match(v.deadlineText, /Send before .* \(24 hours left\)/);
  assert.equal(v.tokenContract, USDC);
  assert.match(v.why, /Base/);
});

test("the deadline text is gone once the quote has expired", () => {
  const v = depositView({
    intent: { ...intent(), deadline: "2026-11-01T00:00:00Z" },
    wallet: WALLET,
    fromChain: { label: "Base", native: "ETH" },
    toChain: { label: "Avalanche", native: "AVAX" },
    nowMs: NOW,
  });
  assert.equal(v.deadlineText, null);
});

test("small formatting helpers", () => {
  assert.equal(formatUnits("280000", 6), "0.28");
  assert.equal(formatUnits("33086329771846088", 18), "0.033086329771846088");
  assert.equal(formatUnits("5", 6), "0.000005");
  assert.equal(formatUnits("not a number", 6), null);
  assert.equal(shortAddr(WALLET), "0xBA39…b111");
  assert.equal(chunkAddress(DEPOSIT), "0x B629 DA4E 405F 813e 3577 be48 29E9 C079 Fc62 bad7");
  assert.equal(Math.round(hoursLeft("2026-11-08T22:10:00Z", NOW)), 24);
});

test("the server now passes the deadline and refund fee through to the page", () => {
  const q = normalizeQuote({
    quote: { amountOut: "1", amountIn: "2", deadline: "2026-11-08T22:09:48.925Z", refundFee: "2400", timeEstimate: 40 },
  });
  assert.equal(q.deadline, "2026-11-08T22:09:48.925Z");
  assert.equal(q.refundFee, "2400");
});
