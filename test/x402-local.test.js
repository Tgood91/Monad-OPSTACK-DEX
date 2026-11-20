import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  parsePayment,
  settleCalldata,
  createLocalFacilitator,
  settlerKey,
  usdcDomain,
  AUTH_TYPES,
  USDC_ABI,
} from "../server/x402-local.js";
import { agentConfig, paymentRequirements } from "../server/agent-job.js";

const REQ = paymentRequirements(agentConfig({}));
const NOW = 1_800_000_000;
const now = () => NOW;

async function signed(wallet, over = {}, signer = wallet) {
  const auth = {
    from: wallet.address,
    to: REQ.payTo,
    value: REQ.maxAmountRequired,
    validAfter: String(NOW - 600),
    validBefore: String(NOW + 300),
    nonce: ethers.hexlify(ethers.randomBytes(32)),
    ...over,
  };
  const signature = await signer.signTypedData(usdcDomain(REQ), AUTH_TYPES, auth);
  return { x402Version: 1, scheme: "exact", network: "base", payload: { signature, authorization: auth } };
}

function fakeChain({
  balance = 10n ** 6n,
  used = false,
  simulateOk = true,
  gas = 10n ** 15n,
  fee = 10n ** 7n,
  receipt = { status: 1 },
  waitError = null,
} = {}) {
  const log = [];
  return {
    log,
    address: "0x00000000000000000000000000000000000000Aa",
    balanceOf: async () => balance,
    authorizationUsed: async () => used,
    gasBalance: async () => gas,
    feePerGas: async () => fee,
    simulate: async () => {
      log.push("simulate");
      if (!simulateOk) throw Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION" });
      return "0x";
    },
    estimateGas: async () => 80_000n,
    send: async (data, gasLimit) => {
      log.push(["send", gasLimit, data.slice(0, 10)]);
      await new Promise((r) => setTimeout(r, 5));
      return {
        hash: "0xfeed",
        wait: async () => {
          if (waitError) throw waitError;
          log.push("mined");
          return receipt;
        },
      };
    },
  };
}

const KEY_A = "0x" + "11".repeat(32);
const KEY_B = "0x" + "22".repeat(32);

test("settler key: X402_SETTLER_KEY first, else the faucet burner already on the server, junk refused", () => {
  assert.equal(settlerKey({ X402_SETTLER_KEY: KEY_A, FAUCET_PRIVATE_KEY: KEY_B }), KEY_A);
  assert.equal(settlerKey({ FAUCET_PRIVATE_KEY: KEY_B }), KEY_B);
  assert.equal(settlerKey({ FAUCET_PRIVATE_KEY: "nope" }), null);
  assert.equal(settlerKey({}), null);
});

test("payload checks: network, payTo, amount, time window, nonce and signature shape", async () => {
  const w = ethers.Wallet.createRandom();
  const good = await signed(w);
  assert.ok(parsePayment(good, REQ, NOW).args);
  const bad = (over, top = {}) =>
    parsePayment(
      { ...good, ...top, payload: { ...good.payload, authorization: { ...good.payload.authorization, ...over } } },
      REQ,
      NOW,
    ).invalidReason;
  assert.equal(bad({}, { network: "base-sepolia" }), "invalid_network");
  assert.equal(bad({}, { scheme: "upto" }), "invalid_scheme");
  assert.equal(bad({ to: w.address }), "invalid_exact_evm_payload_recipient_mismatch");
  assert.equal(bad({ value: "9999" }), "invalid_exact_evm_payload_authorization_value");
  assert.equal(bad({ validAfter: String(NOW + 1) }), "invalid_exact_evm_payload_authorization_valid_after");
  assert.equal(bad({ validBefore: String(NOW + 10) }), "invalid_exact_evm_payload_authorization_valid_before");
  assert.equal(bad({ nonce: "0x12" }), "invalid_payload");
  assert.equal(
    parsePayment({ ...good, payload: { ...good.payload, signature: "0x1234" } }, REQ, NOW).invalidReason,
    "invalid_exact_evm_payload_signature",
  );
});

test("calldata is USDC transferWithAuthorization(..., bytes signature) with the signed fields", async () => {
  const w = ethers.Wallet.createRandom();
  const { args } = parsePayment(await signed(w), REQ, NOW);
  const decoded = new ethers.Interface(USDC_ABI).decodeFunctionData("transferWithAuthorization", settleCalldata(args));
  assert.equal(decoded[0], w.address);
  assert.equal(decoded[1].toLowerCase(), REQ.payTo.toLowerCase());
  assert.equal(decoded[2], 10000n);
  assert.equal(decoded[6], args.signature);
});

test("verify: a real signature from the payer passes and names the payer", async () => {
  const w = ethers.Wallet.createRandom();
  const fac = createLocalFacilitator({ chain: fakeChain(), now });
  const v = await fac.verify(await signed(w), REQ);
  assert.deepEqual(v, { isValid: true, payer: w.address });
});

test("verify: a signature by someone else, a used authorization, too little USDC, or a failed dry run are refused", async () => {
  const w = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();
  const ok = createLocalFacilitator({ chain: fakeChain(), now });
  assert.equal((await ok.verify(await signed(w, {}, other), REQ)).invalidReason, "invalid_exact_evm_payload_signature");
  const used = createLocalFacilitator({ chain: fakeChain({ used: true }), now });
  assert.equal((await used.verify(await signed(w), REQ)).invalidReason, "invalid_transaction_state");
  const poor = createLocalFacilitator({ chain: fakeChain({ balance: 9999n }), now });
  assert.equal((await poor.verify(await signed(w), REQ)).invalidReason, "insufficient_funds");
  const reverts = createLocalFacilitator({ chain: fakeChain({ simulateOk: false }), now });
  assert.match((await reverts.verify(await signed(w), REQ)).invalidReason, /^invalid_transaction_state/);
});

test("verify: an empty gas wallet stops the job before it runs (503, nothing charged)", async () => {
  const w = ethers.Wallet.createRandom();
  const fac = createLocalFacilitator({ chain: fakeChain({ gas: 0n }), now });
  await assert.rejects(fac.verify(await signed(w), REQ), (e) => e.status === 503 && /gas wallet/.test(e.message));
  assert.equal((await fac.status()).ready, false);
  assert.equal((await createLocalFacilitator({ chain: fakeChain(), now }).status()).ready, true);
});

test("settle: dry run, send with 20% gas headroom, one confirmation", async () => {
  const w = ethers.Wallet.createRandom();
  const chain = fakeChain();
  const fac = createLocalFacilitator({ chain, now });
  const s = await fac.settle(await signed(w), REQ);
  assert.deepEqual(s, { success: true, transaction: "0xfeed", network: "base", payer: w.address });
  assert.deepEqual(chain.log, ["simulate", ["send", 96_000n, "0xcf092995"], "mined"]);
});

test("settle: sends are queued one at a time (one key, one nonce sequence)", async () => {
  const w = ethers.Wallet.createRandom();
  const chain = fakeChain();
  const fac = createLocalFacilitator({ chain, now });
  await Promise.all([fac.settle(await signed(w), REQ), fac.settle(await signed(w), REQ)]);
  const order = chain.log.map((x) => (Array.isArray(x) ? x[0] : x));
  assert.deepEqual(order, ["simulate", "send", "mined", "simulate", "send", "mined"]);
});

test("settle: a reverted transfer is a failure; a slow one is delivered as pending", async () => {
  const w = ethers.Wallet.createRandom();
  const reverted = createLocalFacilitator({ chain: fakeChain({ receipt: { status: 0 } }), now });
  assert.equal((await reverted.settle(await signed(w), REQ)).success, false);
  const slow = createLocalFacilitator({
    chain: fakeChain({ waitError: Object.assign(new Error("t"), { code: "TIMEOUT" }) }),
    now,
  });
  const s = await slow.settle(await signed(w), REQ);
  assert.equal(s.success, true);
  assert.equal(s.pending, true);
  const failed = createLocalFacilitator({ chain: fakeChain({ simulateOk: false }), now });
  assert.equal((await failed.settle(await signed(w), REQ)).success, false);
});
