import test from "node:test";
import assert from "node:assert/strict";
import { Attribution } from "ox/erc8021";
import { BUILDER_CODE, DATA_SUFFIX, withBuilderCode, hasBuilderCode } from "../src/attribution.js";

test("the suffix is the ERC-8021 encoding of the builder code", () => {
  assert.equal(BUILDER_CODE, "bc_zjp6vs17");
  assert.match(DATA_SUFFIX, /(8021){8}$/); // last 16 bytes are the repeating 8021 marker
  assert.deepEqual(Attribution.fromData("0xdeadbeef" + DATA_SUFFIX.slice(2)).codes, [BUILDER_CODE]);
});

test("Base transactions get the suffix; the rest of the transaction is untouched", () => {
  const tx = { to: "0x1111111111111111111111111111111111111111", data: "0xdeadbeef", value: 5n };
  const out = withBuilderCode(tx, 8453);
  assert.equal(out.data, "0xdeadbeef" + DATA_SUFFIX.slice(2));
  assert.equal(out.to, tx.to);
  assert.equal(out.value, 5n);
  assert.equal(tx.data, "0xdeadbeef"); // input not mutated
});

test("other chains are returned unchanged", () => {
  const tx = { to: "0x1111111111111111111111111111111111111111", data: "0xdeadbeef" };
  for (const id of [1, 10, 143, 42161, 43114, 56]) assert.equal(withBuilderCode(tx, id), tx);
});

test("the suffix is never added twice, and empty or odd calldata is handled", () => {
  const once = withBuilderCode({ data: "0xdeadbeef" }, 8453);
  assert.equal(withBuilderCode(once, 8453).data, once.data);
  assert.equal(hasBuilderCode(once.data), true);
  assert.equal(withBuilderCode({ data: "0x" }, 8453).data, DATA_SUFFIX);
  assert.equal(withBuilderCode({}, "8453").data, DATA_SUFFIX);
  const bad = { data: "0xabc" };
  assert.equal(withBuilderCode(bad, 8453), bad);
});
