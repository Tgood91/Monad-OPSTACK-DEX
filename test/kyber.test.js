import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, KYBER_CLIENT_ID } from "../src/dex/adapters.js";

const tokenIn = { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 };
const tokenOut = { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 };

test("KyberSwap quote and build both send the x-client-id header", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), headers: init.headers || {} });
    if (String(url).includes("/routes")) {
      return {
        json: async () => ({ data: { routeSummary: { amountOut: "123", amountOutUsd: "1", gasUsd: "0.01" } } }),
      };
    }
    return {
      json: async () => ({
        data: { data: "0xabc", routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", transactionValue: "0" },
      }),
    };
  };
  try {
    const q = await ADAPTERS.kyberswap.quote("base", tokenIn, tokenOut, 5_000_000n);
    await ADAPTERS.kyberswap.buildTx({ ...q, chainKey: "base" }, "0x1111111111111111111111111111111111111bee", 50);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(seen.length, 2);
  for (const call of seen) assert.equal(call.headers["x-client-id"], KYBER_CLIENT_ID);
  assert.equal(seen[1].headers["Content-Type"], "application/json"); // build keeps its JSON header
  assert.equal(KYBER_CLIENT_ID, "bushido-dapp");
});
