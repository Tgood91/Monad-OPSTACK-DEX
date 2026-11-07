// 1inch Fusion: relay safety and the full gasless-swap path, offline.
// A mock "1inch" HTTP server stands in for api.1inch.com/fusion; everything
// else (our relay, the real @1inch/fusion-sdk, our wallet connector) is real.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ethers } from "ethers";
import { fusionTarget, createFusionRelay } from "../server/fusion-relay.js";
import {
  fusionQuote,
  placeFusionOrder,
  waitForFusionFill,
  walletConnector,
  fusionSpender,
  explainFusionError,
} from "../src/dex/fusion-core.js";

const USDC = { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 };
const WETH_NATIVE = {
  symbol: "ETH",
  address: "0x4200000000000000000000000000000000000006",
  decimals: 18,
  isNative: true,
};
const MON = { symbol: "MON", address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", decimals: 18, isNative: true };

/* ---------- relay: what it will and won't forward ---------- */

test("relay allows Fusion quote / submit / status on supported chains", () => {
  assert.deepEqual(fusionTarget("GET", "/quoter/v2.0/8453/quote/receive/?amount=1"), {
    path: "/quoter/v2.0/8453/quote/receive/",
    query: "?amount=1",
  });
  assert.equal(fusionTarget("POST", "/relayer/v2.0/143/order/submit").path, "/relayer/v2.0/143/order/submit");
  assert.equal(fusionTarget("GET", "/orders/v2.0/10/order/status/0xabc").path, "/orders/v2.0/10/order/status/0xabc");
});

test("relay rejects other services, odd paths, other chains and wrong methods", () => {
  assert.equal(fusionTarget("GET", "/admin/v1.0/8453/x").status, 404);
  assert.equal(fusionTarget("GET", "/quoter/v2.0/8453/../../../etc").status, 404);
  assert.equal(fusionTarget("GET", "/quoter/v2.0/8453//x").status, 404);
  assert.equal(fusionTarget("GET", "/quoter/v2.0/1/quote/receive/").status, 400); // Ethereum: not offered here
  assert.equal(fusionTarget("GET", "/relayer/v2.0/8453/order/submit").status, 405); // submit is POST only
  assert.equal(fusionTarget("POST", "/orders/v2.0/8453/order/status/0x1").status, 405);
  assert.equal(fusionTarget("GET", "quoter/v2.0/8453/x").status, 400);
});

function fakeRes() {
  const r = { code: 200, headers: {}, body: undefined };
  r.status = (c) => {
    r.code = c;
    return r;
  };
  r.type = () => r;
  r.json = (o) => {
    r.body = JSON.stringify(o);
    return r;
  };
  r.send = (b) => {
    r.body = b;
    return r;
  };
  return r;
}

test("relay adds the server key, ignores client auth headers, and never echoes the key", async () => {
  let seen;
  const relay = createFusionRelay({
    getToken: async () => "SERVER-SECRET",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { status: 200, text: async () => '{"ok":true}' };
    },
  });
  const res = fakeRes();
  await relay(
    {
      method: "GET",
      originalUrl: "/api/fusion/quoter/v2.0/8453/quote/receive/?a=1",
      body: undefined,
      headers: { authorization: "Bearer ATTACKER" },
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(seen.url, "https://api.1inch.com/fusion/quoter/v2.0/8453/quote/receive/?a=1");
  assert.equal(seen.init.headers.Authorization, "Bearer SERVER-SECRET");
  assert.ok(!res.body.includes("SERVER-SECRET"));
});

test('relay without a key answers 503 "not set"; upstream 401 never leaks upstream text', async () => {
  const none = createFusionRelay({
    getToken: async () => {
      throw new Error("x");
    },
  });
  let res = fakeRes();
  await none({ method: "GET", originalUrl: "/api/fusion/quoter/v2.0/8453/q" }, res);
  assert.equal(res.code, 503);
  assert.match(res.body, /ONEINCH_API_KEY not set/);

  const denied = createFusionRelay({
    getToken: async () => "k",
    fetchImpl: async () => ({ status: 401, text: async () => '{"detail":"Bearer k is invalid"}' }),
  });
  res = fakeRes();
  await denied({ method: "GET", originalUrl: "/api/fusion/quoter/v2.0/8453/q" }, res);
  assert.equal(res.code, 401);
  assert.ok(!res.body.includes("Bearer k"));
  assert.match(explainFusionError(new Error(JSON.parse(res.body).error)), /API key not set/);
});

/* ---------- end to end against a mock 1inch ---------- */

const preset = (end) => ({
  auctionDuration: 180,
  startAuctionIn: 12,
  bankFee: "0",
  initialRateBump: 210661,
  auctionStartAmount: String(end + 12_000_000_000_000n),
  auctionEndAmount: String(end),
  tokenFee: "0",
  points: [{ delay: 24, coefficient: 50461 }],
  allowPartialFills: true,
  allowMultipleFills: true,
  exclusiveResolver: null,
  gasCost: { gasBumpEstimate: 0, gasPriceEstimate: "0" },
});
const OUT = 24_000_000_000_000_000n; // expected output (0.024 token)
const MIN = 23_500_000_000_000_000n; // guaranteed minimum
const QUOTE = {
  fromTokenAmount: "100000000",
  recommended_preset: "medium",
  autoK: 5.5,
  presets: { fast: preset(MIN), medium: preset(MIN), slow: preset(MIN) },
  toTokenAmount: String(OUT),
  prices: { usd: { fromToken: "1", toToken: "2500" } },
  volume: { usd: { fromToken: "100", toToken: "99" } },
  quoteId: "quote-123",
  settlementAddress: "0xa88800cd213da5ae406ce248380802bd53b47647",
  whitelist: ["0x84d99aa569d93a9ca187d83734c8c4a519c4e9b1"],
  fee: { whitelistDiscountPercent: 1, receiver: "0x111111125421ca6dc452d289314280a0f8842a65", bps: 10 },
  marketAmount: String(OUT),
};

let mock,
  relayServer,
  origin,
  submitted = [],
  upstreamAuth = [],
  statusCalls = 0;

before(async () => {
  mock = http.createServer((req, res) => {
    upstreamAuth.push(req.headers.authorization);
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "GET" && req.url.startsWith("/quoter/v2.0/8453/quote/receive/")) return send(200, QUOTE);
    if (req.method === "POST" && req.url === "/relayer/v2.0/8453/order/submit") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        submitted.push(JSON.parse(b));
        send(201, {});
      });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/orders/v2.0/8453/order/status/")) {
      statusCalls++;
      return send(200, {
        status: statusCalls < 3 ? "pending" : "filled",
        fills: statusCalls < 3 ? [] : [{ txHash: "0xfill" }],
      });
    }
    send(404, { description: "nope " + req.url });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;

  const relay = createFusionRelay({ getToken: async () => "test-key", upstream: mockUrl });
  relayServer = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      req.originalUrl = req.url;
      req.body = b ? JSON.parse(b) : undefined;
      const r = {
        status(c) {
          res.statusCode = c;
          return r;
        },
        type() {
          res.setHeader("content-type", "application/json");
          return r;
        },
        json(o) {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(o));
          return r;
        },
        send(t) {
          res.end(t);
          return r;
        },
      };
      relay(req, r);
    });
  });
  await new Promise((r) => relayServer.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${relayServer.address().port}`;
});

after(() => {
  mock?.close();
  relayServer?.close();
});

test("quote: expected output, guaranteed minimum, approval spender; key added server-side", async () => {
  const q = await fusionQuote({
    chainId: 8453,
    origin,
    tokenIn: USDC,
    tokenOut: WETH_NATIVE,
    amountInWei: 100_000_000n,
    wallet: ethers.Wallet.createRandom().address,
  });
  assert.equal(q.amountOut, OUT);
  assert.equal(q.minAmountOut, MIN);
  assert.equal(q.quoteId, "quote-123");
  assert.equal(q.spender.toLowerCase(), "0x111111125421ca6dc452d289314280a0f8842a65");
  assert.equal(q.spender, fusionSpender(8453));
  assert.ok(upstreamAuth.every((a) => a === "Bearer test-key"));
});

test("quote refuses the native coin as the sell token (no allowance to sign against)", async () => {
  await assert.rejects(
    () => fusionQuote({ chainId: 143, origin, tokenIn: MON, tokenOut: USDC, amountInWei: 1n }),
    /native coin/,
  );
});

test("order: wallet signs a valid EIP-712 order, it is submitted, and the fill is awaited", async () => {
  const wallet = ethers.Wallet.createRandom();
  const provider = { call: async () => "0x" };
  let signed;
  const signer = {
    getAddress: async () => wallet.address,
    signTypedData: async (domain, types, message) => {
      signed = { domain, types, message };
      return wallet.signTypedData(domain, types, message);
    },
  };
  const { sdk, orderHash } = await placeFusionOrder({
    chainId: 8453,
    origin,
    connector: walletConnector({ signer, provider }),
    tokenIn: USDC,
    tokenOut: WETH_NATIVE,
    amountInWei: 100_000_000n,
    wallet: wallet.address,
    minAcceptable: MIN - 1n,
  });
  assert.match(orderHash, /^0x[0-9a-f]{64}$/);

  // The submitted body carries the order, and its signature recovers to this wallet.
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].quoteId, "quote-123");
  assert.equal(submitted[0].order.maker.toLowerCase(), wallet.address.toLowerCase());
  assert.equal(signed.domain.chainId, 8453);
  assert.equal(signed.domain.verifyingContract.toLowerCase(), fusionSpender(8453).toLowerCase());
  assert.equal(
    ethers.verifyTypedData(signed.domain, signed.types, signed.message, submitted[0].signature),
    wallet.address,
  );
  assert.ok(!("EIP712Domain" in signed.types));

  const seen = [];
  const fill = await waitForFusionFill({ sdk, orderHash, intervalMs: 5, onStatus: (s) => seen.push(s) });
  assert.deepEqual(seen, ["pending", "pending", "filled"]);
  assert.equal(fill.fills[0].txHash, "0xfill");
});

test("order: refuses before asking for a signature when the price moved against the user", async () => {
  const wallet = ethers.Wallet.createRandom();
  let asked = false;
  const signer = {
    getAddress: async () => wallet.address,
    signTypedData: async () => {
      asked = true;
      return "0x";
    },
  };
  await assert.rejects(
    () =>
      placeFusionOrder({
        chainId: 8453,
        origin,
        connector: walletConnector({ signer, provider: { call: async () => "0x" } }),
        tokenIn: USDC,
        tokenOut: WETH_NATIVE,
        amountInWei: 100_000_000n,
        wallet: wallet.address,
        minAcceptable: MIN + 10n ** 18n,
      }),
    /price moved/,
  );
  assert.equal(asked, false);
});

test("signing is refused if the connected wallet changed", async () => {
  const connector = walletConnector({
    signer: { getAddress: async () => "0x0000000000000000000000000000000000000001" },
    provider: {},
  });
  await assert.rejects(
    () => connector.signTypedData("0x0000000000000000000000000000000000000002", { types: {}, domain: {}, message: {} }),
    /wallet changed/,
  );
});

test("fill wait reports orders that can no longer fill, and says nothing was spent", async () => {
  const sdk = { getOrderStatus: async () => ({ status: "expired", fills: [] }) };
  await assert.rejects(() => waitForFusionFill({ sdk, orderHash: "0x1", intervalMs: 1 }), /Nothing was spent/);
});
