import test from "node:test";
import assert from "node:assert/strict";
import { coversChain, createSessionCache, isEvm } from "../src/siwx-share.js";

const acct = { address: "0xBA397fAae1D5Fe10C0356f2e585bef34577ab111", caip2Network: "eip155:8453" };

test("a sign-in made on Base covers Monad and every other EVM chain", () => {
  for (const id of ["eip155:143", "eip155:10", "eip155:1", "eip155:8453"])
    assert.equal(coversChain(acct, id, acct.address.toLowerCase()), true);
});
test("a different wallet is never covered", () => {
  assert.equal(coversChain(acct, "eip155:143", "0x0000000000000000000000000000000000000001"), false);
});
test("non-EVM chains keep the strict rule", () => {
  assert.equal(coversChain(acct, "solana:abc", acct.address), false);
  assert.equal(isEvm("solana:abc"), false);
});
test("the 60-second cache expires and is per wallet", () => {
  const c = createSessionCache(60_000);
  c.set(acct.address, acct, 1000);
  assert.equal(c.get(acct.address, 30_000), acct);
  assert.equal(c.get(acct.address, 61_001), null);
  assert.equal(c.get("0xother", 2000), null);
  c.clear();
  assert.equal(c.get(acct.address, 2000), null);
});
