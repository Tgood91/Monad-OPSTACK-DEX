import test from "node:test";
import assert from "node:assert/strict";
import { retryOnce } from "../src/utils/retry.js";

const noSleep = async () => {};

test("returns the first answer when it works, without retrying", async () => {
  let n = 0;
  assert.equal(await retryOnce(async () => ++n, { sleep: noSleep }), 1);
  assert.equal(n, 1);
});

test("a one-off failure is retried once and the second answer is used", async () => {
  let n = 0;
  const flaky = async () => {
    if (++n === 1) throw new Error("blip");
    return "ok";
  };
  assert.equal(await retryOnce(flaky, { sleep: noSleep }), "ok");
  assert.equal(n, 2);
});

test("a failure that repeats is passed on after exactly one retry", async () => {
  let n = 0;
  await assert.rejects(
    retryOnce(
      async () => {
        n++;
        throw new Error("still down");
      },
      { sleep: noSleep },
    ),
    /still down/,
  );
  assert.equal(n, 2);
});
