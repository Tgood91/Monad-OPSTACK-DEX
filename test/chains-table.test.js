import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { CHAINS, SOURCE_META } from "../src/dex/chains.js";
import { swapSetup } from "../src/bushido-swap.js";

// Guards the hand-written chain table for every chain (the Stargate table once had nine wrong entries).

test("every chain has the fields the app relies on", () => {
  for (const [key, c] of Object.entries(CHAINS)) {
    assert.equal(c.key, key, `${key} key`);
    assert.ok(Number.isInteger(c.chainId) && c.chainId > 0, `${key} chainId`);
    assert.ok(c.label && c.native && c.explorer.startsWith("https://"), `${key} label/native/explorer`);
    // Every chain needs a working RPC; the newer chains must also have a fallback. (Ink still has just one: a known gap.)
    const minRpcs = ["bsc", "avalanche", "monad", "base"].includes(key) ? 2 : 1;
    assert.ok(
      c.rpcs.length >= minRpcs && c.rpcs.every((u) => u.startsWith("https://")),
      `${key} needs ${minRpcs}+ https RPCs`,
    );
    assert.ok(c.sources.length > 0, `${key} sources`);
    for (const s of c.sources) assert.ok(SOURCE_META[s], `${key}: unknown source ${s}`);
    if (c.sources.includes("kyberswap")) assert.ok(c.kyberName, `${key} lists KyberSwap but has no kyberName`);
  }
});

test("chain IDs and keys are unique", () => {
  const ids = Object.values(CHAINS).map((c) => c.chainId);
  assert.equal(new Set(ids).size, ids.length);
});

test("every token address is a valid, correctly checksummed address; decimals are sane", () => {
  for (const [key, c] of Object.entries(CHAINS)) {
    assert.ok(c.tokens[0].isNative, `${key}: the first token is the native coin`);
    assert.equal(c.tokens.filter((t) => t.isNative).length, 1, `${key}: exactly one native token`);
    const symbols = new Set();
    for (const t of c.tokens) {
      assert.equal(ethers.getAddress(t.address), t.address, `${key} ${t.symbol} checksum`);
      assert.ok(Number.isInteger(t.decimals) && t.decimals >= 6 && t.decimals <= 18, `${key} ${t.symbol} decimals`);
      assert.ok(!symbols.has(t.symbol), `${key} duplicate symbol ${t.symbol}`);
      symbols.add(t.symbol);
    }
  }
});

test("BNB Chain: 18-decimal stablecoins (they are not 6), and the verified addresses", () => {
  const c = CHAINS.bsc;
  assert.equal(c.chainId, 56);
  assert.equal(c.native, "BNB");
  const by = Object.fromEntries(c.tokens.map((t) => [t.symbol, t]));
  assert.equal(by.USDC.decimals, 18);
  assert.equal(by.USDT.decimals, 18);
  assert.equal(by.USDC.address, "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
  assert.equal(by.BNB.address, "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"); // WBNB
  assert.equal(c.kyberName, "bsc");
});

test("Avalanche: 6-decimal USDC and USDt, 8-decimal BTC.b, and the verified addresses", () => {
  const c = CHAINS.avalanche;
  assert.equal(c.chainId, 43114);
  assert.equal(c.native, "AVAX");
  const by = Object.fromEntries(c.tokens.map((t) => [t.symbol, t]));
  assert.equal(by.USDC.decimals, 6);
  assert.equal(by.USDt.decimals, 6);
  assert.equal(by["BTC.b"].decimals, 8);
  assert.equal(by.USDC.address, "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E");
  assert.equal(by.AVAX.address, "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7"); // WAVAX
  assert.equal(c.kyberName, "avalanche");
});

test("only sources that returned a live quote on the new chains are enabled there", () => {
  for (const k of ["bsc", "avalanche"]) {
    assert.deepEqual(CHAINS[k].sources, ["lifi", "kyberswap", "velora", "oneinch", "zerox"]);
  }
});

test("the Bushido swap panel works on the new chains, with a sensible first amount", () => {
  const b = swapSetup("bsc");
  assert.equal(b.tIn.symbol, "BNB");
  assert.equal(b.tOut.symbol, "USDC");
  assert.equal(b.tOut.decimals, 18);
  assert.equal(b.defaultAmount, "0.01");
  assert.ok(!b.sources.includes("fusion"));
  const a = swapSetup("avalanche");
  assert.equal(a.tIn.symbol, "AVAX");
  assert.equal(a.tOut.symbol, "USDC");
  assert.equal(a.tOut.decimals, 6);
  assert.equal(a.defaultAmount, "0.1");
  assert.equal(swapSetup("monad").defaultAmount, "1");
  assert.equal(swapSetup("base").defaultAmount, "0.001");
});
