import test from "node:test";
import assert from "node:assert/strict";
import { zeroxParams, createZeroxProxy, zeroxKey, PLACEHOLDER_TAKER } from "../server/zerox.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const good = { chainId: "8453", sellToken: USDC, buyToken: WETH, sellAmount: "5000000" };

function run(handler, query) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      body: null,
      status(c) {
        this.code = c;
        return this;
      },
      type() {
        return this;
      },
      json(b) {
        resolve({ code: this.code, body: b });
      },
      send(b) {
        resolve({ code: this.code, body: JSON.parse(b) });
      },
    };
    handler({ query }, res);
  });
}

test("validates params and uses a placeholder taker when no wallet", () => {
  assert.equal(zeroxParams({ ...good, chainId: "9" }).status, 400);
  assert.equal(zeroxParams({ ...good, sellToken: "nope" }).status, 400);
  assert.equal(zeroxParams({ ...good, sellAmount: "0" }).status, 400);
  assert.match(zeroxParams(good).query, new RegExp(`taker=${PLACEHOLDER_TAKER}`));
});

test("key comes from ZEROX_API_KEY, falling back to the old VITE_0X_API_KEY name", () => {
  assert.equal(zeroxKey({ ZEROX_API_KEY: " a " }), "a");
  assert.equal(zeroxKey({ VITE_0X_API_KEY: "b" }), "b");
  assert.equal(zeroxKey({}), "");
});

test("proxy sends the key and the v2 header server-side; 503 without a key; maps 401", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { status: 200, text: async () => JSON.stringify({ buyAmount: "123" }) };
  };
  const ok = await run(createZeroxProxy({ getKey: () => "K", fetchImpl }), good);
  assert.equal(ok.body.buyAmount, "123");
  assert.equal(seen.init.headers["0x-api-key"], "K");
  assert.equal(seen.init.headers["0x-version"], "v2");

  const none = await run(createZeroxProxy({ getKey: () => "", fetchImpl }), good);
  assert.equal(none.code, 503);

  const f401 = async () => ({ status: 401, text: async () => "{}" });
  const bad = await run(createZeroxProxy({ getKey: () => "K", fetchImpl: f401 }), good);
  assert.match(bad.body.error, /rejected the API key/);
});
