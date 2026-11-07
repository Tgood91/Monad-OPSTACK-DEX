import test from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../server/limits.js";
import { disabledSources, sourceForPath, switchesMiddleware } from "../server/switches.js";

function call(mw, url, ip = "1.1.1.1") {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) {
        this.code = c;
        return this;
      },
      json(b) {
        resolve({ code: this.code, body: b });
      },
    };
    mw({ originalUrl: url, ip }, res, () => resolve({ code: 200, passed: true }));
  });
}

test("quote lookups have their own bucket: 60 quotes x 6 sources do not lock the visitor out", async () => {
  const limiter = createLimiter({ general: 90, quotes: 400 });
  for (let i = 0; i < 360; i++) assert.equal((await call(limiter, "/api/zerox/quote?chainId=8453")).code, 200);
  // the general bucket is untouched, so other calls still work
  assert.equal((await call(limiter, "/api/near/status?x=1")).code, 200);
});

test("the general bucket still limits at 90 per minute, and resets after the window", async () => {
  let t = 0;
  const limiter = createLimiter({ general: 90, quotes: 400, now: () => t });
  for (let i = 0; i < 90; i++) assert.equal((await call(limiter, "/api/near/status")).code, 200);
  assert.equal((await call(limiter, "/api/near/status")).code, 429);
  t += 61_000;
  assert.equal((await call(limiter, "/api/near/status")).code, 200);
});

test("quote bucket also has a ceiling, and visitors are counted separately", async () => {
  const limiter = createLimiter({ general: 5, quotes: 10 });
  for (let i = 0; i < 10; i++) await call(limiter, "/api/zerion/quote");
  assert.equal((await call(limiter, "/api/zerion/quote")).code, 429);
  assert.equal((await call(limiter, "/api/zerion/quote", "2.2.2.2")).code, 200);
});

test("DISABLED_SOURCES parses, ignores unknown names and tidies case/spaces", () => {
  assert.deepEqual(disabledSources({ DISABLED_SOURCES: " Zerion , fusion,nope" }), ["zerion", "fusion"]);
  assert.deepEqual(disabledSources({}), []);
});

test("routes map to their source", () => {
  assert.equal(sourceForPath("/api/zerox/quote"), "zerox");
  assert.equal(sourceForPath("/api/fusion/quoter/v2.0/8453/quote/receive"), "fusion");
  assert.equal(sourceForPath("/api/coinbase/swap-quote"), "coinbase");
  assert.equal(sourceForPath("/api/coinbase/prices"), null); // prices are not a swap source
  assert.equal(sourceForPath("/api/near/quote"), null);
});

test("a disabled source's routes answer 503 and others pass", async () => {
  const mw = switchesMiddleware({ DISABLED_SOURCES: "zerion" });
  const off = await call(mw, "/api/zerion/quote");
  assert.equal(off.code, 503);
  assert.match(off.body.error, /turned off/);
  assert.equal((await call(mw, "/api/oneinch/quote")).passed, true);
});
