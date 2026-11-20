// Self-hosted x402 settlement on Base, using the one wallet key the server already holds.
//
// Why: the Render service has no Coinbase (CDP) key, and the owner asked to use only the keys already set there.
// The server's one wallet key is the faucet burner (FAUCET_PRIVATE_KEY). Here it only pays the Base gas to submit
// a payer's signed USDC authorization (EIP-3009 transferWithAuthorization). The USDC moves straight from the payer
// to the agent's payTo address (the fee wallet); it never passes through the burner, and the burner cannot change
// where it goes (the payer's signature fixes `to` and `value`). X402_SETTLER_KEY can point this at another burner.
//
// verify(): the x402 "exact" payload is checked locally (payTo, amount, time window, nonce, the EIP-712 signature
//   for ordinary wallets), then on Base: the payer's USDC balance, that the authorization is unused, a dry run of
//   the transfer from the burner (this also checks smart-wallet signatures), and that the burner has the gas to
//   submit it. A job only runs when its payment can really be collected.
// settle(): dry-runs again, sends the transfer from the burner, waits for one confirmation. One key means one
//   nonce sequence, so sends are queued one at a time.
//
// Base USDC (0x8335…2913, implementation FiatTokenV2_2) has transferWithAuthorization(..., bytes signature) and
// authorizationState(authorizer, nonce): read from the verified implementation ABI on Basescan.

import { ethers } from "ethers";

export const BASE_CHAIN_ID = 8453;
// Same list and order as src/dex/chains.js (Base), checked there on 2026-11-05.
export const BASE_RPCS = ["https://mainnet.base.org", "https://base.api.pocket.network", "https://base.drpc.org"];
const KEY = /^0x[0-9a-fA-F]{64}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const NONCE = /^0x[0-9a-fA-F]{64}$/;
const SIG = /^0x([0-9a-fA-F]{2})+$/;
// A transferWithAuthorization costs about 60-90k gas; keep enough for one at twice the current fee.
const GAS_PER_SETTLE = 120_000n;

export const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
];

export const AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/** The settler key: X402_SETTLER_KEY if set, otherwise the faucet burner already on the server. */
export function settlerKey(env = process.env) {
  const k = String(env.X402_SETTLER_KEY || env.FAUCET_PRIVATE_KEY || "").trim();
  return KEY.test(k) ? k : null;
}

export function usdcDomain(req) {
  return {
    name: req.extra?.name || "USD Coin",
    version: req.extra?.version || "2",
    chainId: BASE_CHAIN_ID,
    verifyingContract: req.asset,
  };
}

/** Check the payment payload against the requirements. Returns { args } or { invalidReason }. */
export function parsePayment(payload, req, nowSec, minWindowSec = 30) {
  if (!payload || payload.x402Version !== 1) return { invalidReason: "invalid_x402_version" };
  if (payload.scheme !== "exact") return { invalidReason: "invalid_scheme" };
  if (payload.network !== "base") return { invalidReason: "invalid_network" };
  const a = payload.payload?.authorization || {};
  const signature = String(payload.payload?.signature || "");
  if (!ADDR.test(String(a.from)) || !ADDR.test(String(a.to))) return { invalidReason: "invalid_payload" };
  if (String(a.to).toLowerCase() !== String(req.payTo).toLowerCase())
    return { invalidReason: "invalid_exact_evm_payload_recipient_mismatch" };
  let value, validAfter, validBefore;
  try {
    value = BigInt(String(a.value));
    validAfter = BigInt(String(a.validAfter));
    validBefore = BigInt(String(a.validBefore));
  } catch {
    return { invalidReason: "invalid_payload" };
  }
  if (value < BigInt(req.maxAmountRequired)) return { invalidReason: "invalid_exact_evm_payload_authorization_value" };
  if (validAfter >= BigInt(nowSec)) return { invalidReason: "invalid_exact_evm_payload_authorization_valid_after" };
  if (validBefore <= BigInt(nowSec + minWindowSec))
    return { invalidReason: "invalid_exact_evm_payload_authorization_valid_before" };
  if (!NONCE.test(String(a.nonce))) return { invalidReason: "invalid_payload" };
  if (!SIG.test(signature) || signature.length < 132) return { invalidReason: "invalid_exact_evm_payload_signature" };
  return {
    args: {
      from: ethers.getAddress(a.from),
      to: ethers.getAddress(a.to),
      value,
      validAfter,
      validBefore,
      nonce: a.nonce,
      signature,
    },
  };
}

/** The transaction data for USDC.transferWithAuthorization(..., bytes signature). */
export function settleCalldata(args) {
  return new ethers.Interface(USDC_ABI).encodeFunctionData("transferWithAuthorization", [
    args.from,
    args.to,
    args.value,
    args.validAfter,
    args.validBefore,
    args.nonce,
    args.signature,
  ]);
}

class Unavailable extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
  }
}

/** Base access for the settler, through our public RPCs. Reads fall through the list; a send uses one RPC only. */
export function createBaseChain({ key, rpcs = BASE_RPCS, usdc }) {
  const providers = rpcs.map((u) => new ethers.JsonRpcProvider(u, BASE_CHAIN_ID, { staticNetwork: true }));
  const address = new ethers.Wallet(key).address;
  async function read(fn) {
    let last;
    for (const p of providers) {
      try {
        return await fn(p);
      } catch (e) {
        // A revert is an answer, not an RPC failure: do not ask the next RPC.
        if (e?.code === "CALL_EXCEPTION") throw e;
        last = e;
      }
    }
    throw last;
  }
  const token = (p) => new ethers.Contract(usdc, USDC_ABI, p);
  return {
    address,
    balanceOf: (who) => read((p) => token(p).balanceOf(who)),
    authorizationUsed: (who, nonce) => read((p) => token(p).authorizationState(who, nonce)),
    gasBalance: () => read((p) => p.getBalance(address)),
    feePerGas: () =>
      read(async (p) => {
        const f = await p.getFeeData();
        return f.maxFeePerGas ?? f.gasPrice ?? 0n;
      }),
    simulate: (data) => read((p) => p.call({ to: usdc, from: address, data })),
    estimateGas: (data) => read((p) => p.estimateGas({ to: usdc, from: address, data })),
    // One RPC, never retried elsewhere: a retry could send the same payment twice.
    send: (data, gasLimit) => new ethers.Wallet(key, providers[0]).sendTransaction({ to: usdc, data, gasLimit }),
  };
}

/**
 * x402 facilitator that settles on Base itself. `chain` is injectable for tests (see createBaseChain).
 * `minGasWei` overrides the gas check (tests); `now` returns seconds.
 */
export function createLocalFacilitator({ chain, now = () => Math.floor(Date.now() / 1000), waitMs = 60_000 }) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function gasCheck(gas) {
    const [have, fee] = await Promise.all([chain.gasBalance(), chain.feePerGas()]);
    const need = (gas ?? GAS_PER_SETTLE) * fee * 2n;
    return { ok: have >= need, have, need };
  }

  return {
    kind: "self",
    address: chain.address,

    /** For the info route: can a payment be collected right now? */
    async status() {
      try {
        const g = await gasCheck();
        return g.ok
          ? { ready: true }
          : { ready: false, reason: "The agent's gas wallet is out of ETH on Base, so hiring is paused." };
      } catch {
        return { ready: false, reason: "Base is not answering right now." };
      }
    },

    async verify(payload, req) {
      const p = parsePayment(payload, req, now());
      if (p.invalidReason) return { isValid: false, invalidReason: p.invalidReason };
      const { args } = p;
      // Ordinary wallets sign with a 65-byte ECDSA signature: check it here. Smart wallets (ERC-1271) are
      // checked by USDC itself in the dry run below.
      if (args.signature.length === 132) {
        let signer = null;
        try {
          const auth = {
            from: args.from,
            to: args.to,
            value: args.value,
            validAfter: args.validAfter,
            validBefore: args.validBefore,
            nonce: args.nonce,
          };
          signer = ethers.verifyTypedData(usdcDomain(req), AUTH_TYPES, auth, args.signature);
        } catch {
          /* fall through */
        }
        if (!signer || signer.toLowerCase() !== args.from.toLowerCase())
          return { isValid: false, invalidReason: "invalid_exact_evm_payload_signature" };
      }
      const [balance, used] = await Promise.all([
        chain.balanceOf(args.from),
        chain.authorizationUsed(args.from, args.nonce),
      ]);
      if (used) return { isValid: false, invalidReason: "invalid_transaction_state" };
      if (balance < args.value) return { isValid: false, invalidReason: "insufficient_funds" };
      const data = settleCalldata(args);
      try {
        await chain.simulate(data);
      } catch (e) {
        return {
          isValid: false,
          invalidReason: `invalid_transaction_state: ${String(e?.shortMessage || e?.message || e).slice(0, 80)}`,
        };
      }
      const gas = await chain.estimateGas(data);
      const g = await gasCheck(gas);
      if (!g.ok)
        throw new Unavailable(
          "The agent's gas wallet is out of ETH on Base, so hiring is paused. Nothing was charged.",
        );
      return { isValid: true, payer: args.from };
    },

    settle(payload, req) {
      return serial(async () => {
        const p = parsePayment(payload, req, now(), 2);
        if (p.invalidReason) return { success: false, errorReason: p.invalidReason };
        const { args } = p;
        const data = settleCalldata(args);
        try {
          await chain.simulate(data);
        } catch {
          return { success: false, errorReason: "invalid_transaction_state" };
        }
        const gas = await chain.estimateGas(data);
        const tx = await chain.send(data, (gas * 12n) / 10n);
        try {
          const receipt = await tx.wait(1, waitMs);
          if (!receipt || receipt.status !== 1)
            return { success: false, errorReason: "settle_reverted", transaction: tx.hash };
        } catch (e) {
          // Still pending after the wait: it passed the dry run, so it is delivered and marked pending.
          if (e?.code === "TIMEOUT")
            return { success: true, transaction: tx.hash, network: "base", payer: args.from, pending: true };
          return { success: false, errorReason: "settle_reverted", transaction: tx.hash };
        }
        return { success: true, transaction: tx.hash, network: "base", payer: args.from };
      });
    },
  };
}
