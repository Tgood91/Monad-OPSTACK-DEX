import test from "node:test";
import assert from "node:assert/strict";
import {
  createRelay,
  tokensOf,
  findToken,
  publishedContracts,
  checkRelayQuote,
  RELAY_CHAINS,
} from "../server/relay.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
const ZERO = "0x0000000000000000000000000000000000000000";
const REQ = "0x" + "ab".repeat(32);
const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");

const base = {
  id: 8453,
  name: "base",
  displayName: "Base",
  vmType: "evm",
  disabled: false,
  depositEnabled: true,
  currency: { symbol: "ETH", address: ZERO, decimals: 18 },
  solverCurrencies: [
    { symbol: "USDC", address: USDC, decimals: 6 },
    { symbol: "ETH", address: ZERO, decimals: 18 },
  ],
  protocol: { v2: { depository: DEPOSITORY } },
  contracts: {
    multicall3: "",
    relayReceiver: "0xa5f565650890fba1824ee0f21ebbbf660a179934",
    v3: { erc20Router: "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f" },
  },
};
const monad = {
  id: 143,
  name: "monad",
  vmType: "evm",
  disabled: false,
  depositEnabled: true,
  currency: { symbol: "MON", address: ZERO, decimals: 18 },
  solverCurrencies: [],
  protocol: { v2: { depository: DEPOSITORY } },
  contracts: {},
};

const approveData = (spender, amount) => "0x095ea7b3" + pad(spender) + pad(BigInt(amount).toString(16));
function quote({ amount = "5000000", native = false, over = {}, approve = {}, deposit = {} } = {}) {
  const steps = [];
  if (!native)
    steps.push({
      id: "approve",
      kind: "transaction",
      requestId: REQ,
      items: [
        {
          data: {
            from: WALLET,
            to: USDC,
            data: approveData(DEPOSITORY, amount),
            value: "0",
            chainId: 8453,
            ...approve,
          },
        },
      ],
    });
  steps.push({
    id: "deposit",
    kind: "transaction",
    requestId: REQ,
    items: [
      {
        data: {
          from: WALLET,
          to: DEPOSITORY,
          data: "0xe8017952" + "00".repeat(32),
          value: native ? amount : "0",
          chainId: 8453,
          ...deposit,
        },
      },
    ],
  });
  return {
    steps,
    fees: { relayer: { amountUsd: "0.028" } },
    details: {
      sender: WALLET,
      recipient: WALLET,
      timeEstimate: 1,
      totalImpact: { percent: "-1.6" },
      currencyIn: { amount, currency: { chainId: 8453, address: native ? ZERO : USDC } },
      currencyOut: {
        amount: "300000000000000000000",
        minimumAmount: "294000000000000000000",
        amountUsd: "4.9",
        currency: { chainId: 143, address: ZERO, decimals: 18 },
      },
    },
    ...over,
  };
}
const ctx = (o = {}) => ({
  chain: base,
  fromChainId: 8453,
  toChainId: 143,
  fi: { symbol: "USDC", address: USDC, decimals: 6 },
  ti: { symbol: "MON", address: null, decimals: 18 },
  amountAtomic: "5000000",
  wallet: WALLET,
  ...o,
});
const nativeCtx = () => ctx({ fi: { symbol: "ETH", address: null, decimals: 18 }, amountAtomic: "2000000000000000" });

test("tokens: the gas coin is null, duplicates and malformed entries are dropped", () => {
  const t = tokensOf({
    ...base,
    solverCurrencies: [
      ...base.solverCurrencies,
      { symbol: "BAD", address: "nope", decimals: 6 },
      { symbol: "X", address: USDC, decimals: 6 },
    ],
  });
  assert.deepEqual(t, [
    { symbol: "ETH", address: null, decimals: 18 },
    { symbol: "USDC", address: USDC, decimals: 6 },
  ]);
  assert.equal(findToken(t, "native").symbol, "ETH");
  assert.equal(findToken(t, USDC.toUpperCase().replace("0X", "0x")).symbol, "USDC");
  assert.equal(findToken(t, "0x" + "9".repeat(40)), null);
  assert.equal(findToken(t, "USDC"), null);
});

test("published contracts: the depository and nested router addresses, never empty strings or zero", () => {
  const set = publishedContracts(base);
  assert.ok(set.has(DEPOSITORY));
  assert.ok(set.has("0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f"));
  assert.equal(set.has(""), false);
  assert.equal(set.has(ZERO), false);
});

test("a good ERC-20 quote passes: exact approval, then one deposit, and only to/data/value/chainId reach the wallet", () => {
  const r = checkRelayQuote(quote(), ctx());
  assert.equal(r.requestId, REQ);
  assert.deepEqual(
    r.txs.map((t) => t.id),
    ["approve", "deposit"],
  );
  assert.deepEqual(Object.keys(r.txs[0]).sort(), ["chainId", "data", "id", "to", "value"]);
});

test("a good native quote passes: one deposit carrying the amount as value", () => {
  const r = checkRelayQuote(quote({ amount: "2000000000000000", native: true }), nativeCtx());
  assert.deepEqual(
    r.txs.map((t) => [t.id, t.value]),
    [["deposit", "2000000000000000"]],
  );
});

test("refused: anything that is not what the user asked for", () => {
  const refuse = (q, c, re) => assert.throws(() => checkRelayQuote(q, c), re);
  const other = "0x2222222222222222222222222222222222222222";
  refuse(quote({ over: { details: { ...quote().details, recipient: other } } }), ctx(), /recipient is not your wallet/);
  refuse(quote({ over: { details: { ...quote().details, sender: other } } }), ctx(), /sender is not your wallet/);
  refuse(quote({ amount: "6000000" }), ctx(), /amount differs/);
  refuse(quote({ deposit: { to: other } }), ctx(), /deposit goes to an unknown contract/);
  refuse(quote({ deposit: { chainId: 1 } }), ctx(), /wrong chain/);
  refuse(quote({ deposit: { from: other } }), ctx(), /not from your wallet/);
  refuse(quote({ deposit: { value: "1" } }), ctx(), /deposit value differs/);
  refuse(quote({ approve: { data: approveData(other, "5000000") } }), ctx(), /unknown contract/);
  refuse(quote({ approve: { data: approveData(DEPOSITORY, "0x" + "f".repeat(64)) } }), ctx(), /exact amount/); // unlimited approval
  refuse(quote({ approve: { to: other } }), ctx(), /different token/);
  refuse(quote({ approve: { data: "0xa9059cbb" + pad(other) + pad("5") } }), ctx(), /not a plain approval/); // a transfer in disguise
  refuse(
    quote({ amount: "2000000000000000", native: true, deposit: { value: "0" } }),
    nativeCtx(),
    /deposit value differs/,
  );
  const sig = quote();
  sig.steps[0].kind = "signature";
  refuse(sig, ctx(), /unexpected signature step/);
  const extra = quote();
  extra.steps.push({ ...extra.steps[1], id: "swap" });
  refuse(extra, ctx(), /unexpected step "swap"/);
  const two = quote();
  two.steps.push(two.steps[1]);
  refuse(two, ctx(), /exactly one deposit/);
  refuse({ details: quote().details, steps: [] }, ctx(), /no steps/);
  const wrongOut = quote();
  wrongOut.details.currencyOut.currency.chainId = 1;
  refuse(wrongOut, ctx(), /wrong destination chain/);
  refuse(quote(), ctx({ chain: { ...base, protocol: {}, contracts: {} } }), /publishes no contracts/);
});

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("quote end to end with a fake Relay: sends the wallet as user, recipient and refund address", async () => {
  const sent = [];
  const fetchImpl = async (url, opts) => {
    if (url.endsWith("/chains")) return json({ chains: [base, monad] });
    sent.push(JSON.parse(opts.body));
    return json(quote());
  };
  const relay = createRelay({ fetchImpl });
  const q = await relay.relayQuote({
    fromChainId: 8453,
    toChainId: 143,
    fromToken: USDC,
    toToken: "native",
    amountAtomic: "5000000",
    wallet: WALLET,
  });
  assert.equal(sent[0].user, WALLET);
  assert.equal(sent[0].recipient, WALLET);
  assert.equal(sent[0].refundTo, WALLET);
  assert.equal(sent[0].tradeType, "EXACT_INPUT");
  assert.equal(sent[0].destinationCurrency, ZERO);
  assert.equal(q.requestId, REQ);
  assert.equal(q.minAmountOut, "294000000000000000000");
  assert.equal(q.steps.length, 2);
  await assert.rejects(
    () =>
      relay.relayQuote({
        fromChainId: 8453,
        toChainId: 143,
        fromToken: "0x" + "9".repeat(40),
        toToken: "native",
        amountAtomic: "1",
        wallet: WALLET,
      }),
    /from token not supported/,
  );
});

test("chains are cached, a disabled or paused chain is refused, and Relay's own error message is passed on", async () => {
  let chainCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/chains"))
      return (
        chainCalls++,
        json({
          chains: [
            { ...base, depositEnabled: false },
            { ...monad, disabled: true },
          ],
        })
      );
    return json({ message: "Swap output amount is too small", errorCode: "AMOUNT_TOO_LOW" }, 400);
  };
  const relay = createRelay({ fetchImpl });
  assert.equal((await relay.relayTokens(8453)).length, 2);
  await relay.relayTokens(8453);
  assert.equal(chainCalls, 1);
  await assert.rejects(() => relay.relayTokens(143), /does not serve chain 143/);
  await assert.rejects(() => relay.relayTokens(999), /does not serve chain 999/);
  const ok = createRelay({
    fetchImpl: async (url) =>
      url.endsWith("/chains")
        ? json({ chains: [base, monad] })
        : json({ message: "Swap output amount is too small" }, 400),
  });
  await assert.rejects(
    () =>
      ok.relayQuote({
        fromChainId: 8453,
        toChainId: 143,
        fromToken: USDC,
        toToken: "native",
        amountAtomic: "10",
        wallet: WALLET,
      }),
    /too small/,
  );
  await assert.rejects(
    () =>
      relay.relayQuote({
        fromChainId: 8453,
        toChainId: 8453 + 0,
        fromToken: USDC,
        toToken: USDC,
        amountAtomic: "10",
        wallet: WALLET,
      }),
    /paused|does not serve/,
  );
});

test("status: validates the id and returns only known fields", async () => {
  const relay = createRelay({ fetchImpl: async () => json({ status: "success", txHashes: ["0xabc"], secret: "x" }) });
  assert.deepEqual(await relay.relayStatus(REQ), {
    status: "success",
    inTxHashes: [],
    txHashes: ["0xabc"],
    details: null,
  });
  await assert.rejects(() => relay.relayStatus("0x12"), /bad requestId/);
});

test("the chain list is the nine bridge chains, including Ink and Unichain", () => {
  assert.equal(RELAY_CHAINS.length, 9);
  assert.ok(RELAY_CHAINS.includes(57073) && RELAY_CHAINS.includes(130));
});
