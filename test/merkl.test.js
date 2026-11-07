import test from "node:test";
import assert from "node:assert/strict";
import { runClaim, waitFor } from "../src/merkl-claim.js";
import { chainBlock } from "../src/merkl-view.js";

const payload = {
  claimable: true,
  to: "0xDist",
  data: "0xabc",
  tokens: [{ symbol: "WMON", claimable: 1.1 }],
  totalUsd: 0.03,
};
const noSleep = async () => {};

function deps(over = {}) {
  const calls = [];
  const d = {
    chainId: 143,
    address: "0xUser",
    sleep: noSleep,
    fetchClaim: async () => {
      calls.push("build");
      return payload;
    },
    getChainId: async () => {
      calls.push("chain?");
      return 143;
    },
    switchChain: async () => {
      calls.push("switch");
    },
    simulate: async () => {
      calls.push("simulate");
      return { ok: true };
    },
    send: async (tx) => {
      calls.push("send:" + tx.to);
      return {
        hash: "0xhash",
        wait: async () => {
          calls.push("wait");
        },
      };
    },
    ...over,
  };
  return { d, calls };
}

test("claim runs build, simulate, send, wait in order", async () => {
  const { d, calls } = deps();
  const r = await runClaim(d);
  assert.equal(r.claimed, true);
  assert.equal(r.hash, "0xhash");
  assert.deepEqual(
    calls.filter((c) => c !== "chain?"),
    ["build", "simulate", "send:0xDist", "wait"],
  );
});

test("switches the wallet to the right chain first, and waits for it", async () => {
  let id = 8453,
    switched = 0;
  const { d, calls } = deps({
    getChainId: async () => id,
    switchChain: async () => {
      switched++;
      id = 143;
    },
  });
  await runClaim(d);
  assert.equal(switched, 1);
  assert.equal(calls.indexOf("simulate") > -1, true);
});

test("a wallet that never switches gives a clear error and sends nothing", async () => {
  const { d, calls } = deps({ getChainId: async () => 8453 });
  await assert.rejects(runClaim(d), /did not switch networks/);
  assert.equal(
    calls.some((c) => c.startsWith("send")),
    false,
  );
});

test("a failed simulation blocks the signature", async () => {
  const { d, calls } = deps({ simulate: async () => ({ ok: false, reason: "execution reverted" }) });
  await assert.rejects(runClaim(d), /Simulation reverted/);
  assert.equal(
    calls.some((c) => c.startsWith("send")),
    false,
  );
});

test("nothing claimable returns a reason without touching the wallet", async () => {
  const { d, calls } = deps({
    fetchClaim: async () => ({ claimable: false, reason: "nothing claimable on this chain right now" }),
  });
  const r = await runClaim(d);
  assert.equal(r.claimed, false);
  assert.match(r.reason, /nothing claimable/);
  assert.equal(calls.includes("simulate"), false);
});

test("waitFor gives up after its tries", async () => {
  let n = 0;
  assert.equal(
    await waitFor(
      async () => {
        n++;
        return false;
      },
      { tries: 3, sleep: noSleep },
    ),
    false,
  );
  assert.equal(n, 3);
});

const row = (o) => ({ symbol: "WMON", claimable: 1, claimableUsd: 0.03, pending: 0, claimReady: true, ...o });

test("button is active when something is ready", () => {
  const h = chainBlock({ chainId: 143, claimableUsd: 0.03, rewards: [row()] });
  assert.match(h, /data-claim="143"/);
  assert.doesNotMatch(h, /disabled/);
});

test("button is always shown: disabled with a reason when nothing is ready", () => {
  const none = chainBlock({ chainId: 8453, rewards: [row({ claimable: 0, claimableUsd: 0, claimReady: false })] });
  assert.match(none, /disabled/);
  assert.match(none, /Nothing to claim/);
  const pend = chainBlock({
    chainId: 8453,
    rewards: [row({ claimable: 0, claimableUsd: 0, claimReady: false, pending: 0.5 })],
  });
  assert.match(pend, /Not ready yet/);
  assert.match(pend, /8 hours/);
});

test("Ethereum dust gets a gas warning", () => {
  const h = chainBlock({ chainId: 1, claimableUsd: 0.01, rewards: [row({ claimableUsd: 0.01 })] });
  assert.match(h, /gas can cost more/);
  const big = chainBlock({ chainId: 1, claimableUsd: 25, rewards: [row({ claimableUsd: 25 })] });
  assert.doesNotMatch(big, /gas can cost more/);
});
