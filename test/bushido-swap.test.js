import test from "node:test";
import assert from "node:assert/strict";
import { swapSetup, pickChain, switchAndConfirm, FALLBACK_CHAIN } from "../src/bushido-swap.js";
import { CHAINS } from "../src/dex/chains.js";

test("every supported chain has a native-coin to USDC setup, and Fusion is left out", () => {
  for (const key of Object.keys(CHAINS)) {
    const s = swapSetup(key);
    assert.equal(s.tIn.isNative, true, key);
    assert.equal(s.tOut.symbol, "USDC", key);
    assert.equal(s.sources.includes("fusion"), false, key);
    assert.ok(s.sources.length > 0, key);
  }
  assert.throws(() => swapSetup("nope"), /unknown chain/);
});

test("Monad: MON to USDC, with the right words and a sensible starting amount", () => {
  const s = swapSetup("monad");
  assert.equal(s.title, "Swap MON → USDC on Monad");
  assert.equal(s.amountLabel, "MON amount");
  assert.equal(s.defaultAmount, "1");
  assert.deepEqual(s.sources, ["lifi", "kyberswap", "oneinch", "zerox"]);
  assert.equal(swapSetup("base").title, "Swap ETH → USDC on Base");
  assert.equal(swapSetup("base").defaultAmount, "0.001");
});

test("the panel follows the wallet's chain when the app supports it, otherwise starts on Monad", () => {
  assert.equal(pickChain("base"), "base");
  assert.equal(pickChain("monad"), "monad");
  assert.equal(pickChain(null), FALLBACK_CHAIN);
  assert.equal(pickChain(undefined), "monad");
  assert.equal(pickChain("ethereum"), "monad"); // a chain the app has no swap setup for
});

const noSleep = async () => {};

test("no switch is attempted when the wallet is already on the chain", async () => {
  let called = false;
  await switchAndConfirm({
    chainKey: "monad",
    label: "Monad",
    getChainKey: () => "monad",
    switchNetwork: async () => {
      called = true;
    },
    sleep: noSleep,
  });
  assert.equal(called, false);
});

test("switches, waits for the wallet to report the new chain, then carries on", async () => {
  let current = "base",
    polls = 0;
  await switchAndConfirm({
    chainKey: "monad",
    label: "Monad",
    getChainKey: () => {
      if (++polls > 3) current = "monad";
      return current;
    },
    switchNetwork: async () => {},
    sleep: noSleep,
  });
  assert.equal(current, "monad");
});

test("a wallet that never moves gives a clear message instead of silently staying on Base", async () => {
  await assert.rejects(
    switchAndConfirm({
      chainKey: "monad",
      label: "Monad",
      getChainKey: () => "base",
      switchNetwork: async () => {},
      sleep: noSleep,
      tries: 3,
    }),
    /did not switch to Monad/,
  );
});

test("a refusal from the wallet is passed through, not swallowed", async () => {
  await assert.rejects(
    switchAndConfirm({
      chainKey: "monad",
      label: "Monad",
      getChainKey: () => "base",
      switchNetwork: async () => {
        throw new Error("User rejected the request");
      },
      sleep: noSleep,
    }),
    /User rejected/,
  );
});

test("wallet already on the chain (asked of the wallet, async): no switch call, no timeout", async () => {
  let switched = 0;
  await switchAndConfirm({
    chainKey: "monad",
    label: "Monad",
    getChainKey: async () => "monad", // the wallet's own answer, even if AppKit's cached value says base
    switchNetwork: async () => {
      switched++;
    },
    sleep: noSleep,
  });
  assert.equal(switched, 0);
});

test("async chain lookup still waits for the wallet to report the new chain", async () => {
  let current = "base",
    polls = 0;
  await switchAndConfirm({
    chainKey: "monad",
    label: "Monad",
    getChainKey: async () => {
      if (++polls > 2) current = "monad";
      return current;
    },
    switchNetwork: async () => {},
    sleep: noSleep,
  });
  assert.equal(current, "monad");
});
