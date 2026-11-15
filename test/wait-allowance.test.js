import test from "node:test";
import assert from "node:assert/strict";
import { waitForAllowance } from "../src/wait-allowance.js";

const noSleep = async () => {};

test("returns true at once when the allowance already covers the amount", async () => {
  let reads = 0;
  const ok = await waitForAllowance(async () => (reads++, 100n), 100n, { sleep: noSleep });
  assert.equal(ok, true);
  assert.equal(reads, 1);
});

test("keeps polling until the chain shows the approval", async () => {
  const seen = [0n, 0n, 50n];
  const ok = await waitForAllowance(async () => seen.shift() ?? 50n, "50", { sleep: noSleep });
  assert.equal(ok, true);
  assert.equal(seen.length, 0);
});

test("a failed read is retried, not treated as a refusal", async () => {
  let n = 0;
  const ok = await waitForAllowance(
    async () => {
      if (n++ === 0) throw new Error("rpc down");
      return 9n;
    },
    5n,
    { sleep: noSleep },
  );
  assert.equal(ok, true);
});

test("gives up with false after the last try", async () => {
  let ticks = 0;
  const ok = await waitForAllowance(async () => 0n, 1n, { tries: 3, sleep: noSleep, onTick: () => ticks++ });
  assert.equal(ok, false);
  assert.equal(ticks, 3);
});
