// Quote engine: fan-out, best-wins ranking, per-source failure isolation.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS } from '../src/dex/adapters.js';
import { quoteAll } from '../src/dex/engine.js';
import { _resetPauses } from '../src/dex/resilience.js';

// A failing source is paused for a minute (resilience.js); don't let one test's failures leak into the next.
beforeEach(() => _resetPauses());

const tokenIn = { symbol: 'MON', address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', decimals: 18, isNative: true };
const tokenOut = { symbol: 'USDC', address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', decimals: 6 };

function stub(src, impl) {
  const orig = ADAPTERS[src].quote;
  ADAPTERS[src].quote = impl;
  return () => { ADAPTERS[src].quote = orig; };
}

test('ranks quotes by amountOut and picks the highest as best', async () => {
  const restore = [
    stub('lifi', async () => ({ source: 'lifi', amountOut: 18270n })),
    stub('kyberswap', async () => ({ source: 'kyberswap', amountOut: 18954n })),
  ];
  try {
    const r = await quoteAll({ chainKey: 'monad', tokenIn, tokenOut, amountInWei: 10n ** 18n, sources: ['lifi', 'kyberswap'], slippageBps: 50 });
    assert.equal(r.best.source, 'kyberswap');
    assert.deepEqual(r.good.map(g => g.source), ['kyberswap', 'lifi']);
  } finally { restore.forEach(f => f()); }
});

test('a failing or empty source is reported inline without breaking the batch', async () => {
  const restore = [
    stub('lifi', async () => { throw new Error('upstream 500'); }),
    stub('kyberswap', async () => null),
  ];
  try {
    const r = await quoteAll({ chainKey: 'monad', tokenIn, tokenOut, amountInWei: 10n ** 18n, sources: ['lifi', 'kyberswap'], slippageBps: 50 });
    assert.equal(r.best, null);
    const by = Object.fromEntries(r.all.map(x => [x.source, x]));
    assert.equal(by.lifi.ok, false);
    assert.match(by.lifi.reason, /upstream 500/);
    assert.equal(by.kyberswap.reason, 'no liquidity');
  } finally { restore.forEach(f => f()); }
});

test('a keyed source without its key is skipped, not called', async () => {
  let called = false;
  const restore = stub('zerox', async () => { called = true; return null; });
  ADAPTERS.zerox.key = () => ''; // pretend this source holds a browser-side key that is missing
  try {
    const r = await quoteAll({ chainKey: 'monad', tokenIn, tokenOut, amountInWei: 1n, sources: ['zerox'], slippageBps: 50 });
    assert.equal(r.all[0].reason, 'API key not set');
    assert.equal(called, false);
  } finally { restore(); delete ADAPTERS.zerox.key; }
});

/* ---- guardrails: skip sources that can't serve the pair, off-switch, progressive results ---- */

const WALLET = '0x1111111111111111111111111111111111111bee';
const erc20 = { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 };
const native = { symbol: 'ETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, isNative: true };

test('sources that cannot serve the pair are skipped without being called', async () => {
  const called = [];
  const restore = ['fusion', 'zerion', 'coinbase', 'uniswap'].map((src) =>
    stub(src, async () => { called.push(src); return null; }));
  try {
    // native sell, no wallet: Fusion (tokens only) and the wallet-needing sources must not be called
    const r = await quoteAll({
      chainKey: 'base', tokenIn: native, tokenOut: erc20, amountInWei: 1n,
      sources: ['fusion', 'zerion', 'coinbase', 'uniswap'], slippageBps: 50, wallet: null,
    });
    assert.deepEqual(called, []);
    assert.equal(r.all.every((x) => x.skipped), true);
    assert.deepEqual(r.all.map((x) => x.source), ['fusion', 'zerion', 'coinbase', 'uniswap']);
  } finally { restore.forEach((f) => f()); }
});

test('with a wallet and a token sale the same sources are called', async () => {
  const called = [];
  const restore = ['zerion', 'uniswap'].map((src) => stub(src, async () => { called.push(src); return { source: src, amountOut: 5n }; }));
  try {
    const r = await quoteAll({
      chainKey: 'base', tokenIn: erc20, tokenOut: native, amountInWei: 1n,
      sources: ['zerion', 'uniswap'], slippageBps: 50, wallet: WALLET,
    });
    assert.deepEqual(called.sort(), ['uniswap', 'zerion']);
    assert.equal(r.good.length, 2);
  } finally { restore.forEach((f) => f()); }
});

test('a chain a source does not support is skipped (Zerion on Monad)', async () => {
  let called = false;
  const restore = stub('zerion', async () => { called = true; return null; });
  try {
    const r = await quoteAll({ chainKey: 'monad', tokenIn, tokenOut, amountInWei: 1n, sources: ['zerion'], slippageBps: 50, wallet: WALLET });
    assert.equal(called, false);
    assert.equal(r.all[0].skipped, true);
    assert.match(r.all[0].reason, /not supported/);
  } finally { restore(); }
});

test('a switched-off source is skipped and never called', async () => {
  let called = false;
  const restore = stub('lifi', async () => { called = true; return { source: 'lifi', amountOut: 1n }; });
  try {
    const r = await quoteAll({ chainKey: 'monad', tokenIn, tokenOut, amountInWei: 1n, sources: ['lifi'], slippageBps: 50, disabled: new Set(['lifi']) });
    assert.equal(called, false);
    assert.equal(r.all[0].skipped, true);
    assert.equal(r.all[0].reason, 'turned off');
  } finally { restore(); }
});

test('results are reported as each source finishes, ranked so far, with the number still pending', async () => {
  const delay = (ms, v) => new Promise((res) => setTimeout(() => res(v), ms));
  const restore = [
    stub('lifi', () => delay(5, { source: 'lifi', amountOut: 100n })),
    stub('kyberswap', () => delay(40, { source: 'kyberswap', amountOut: 200n })),
  ];
  const seen = [];
  try {
    const r = await quoteAll({
      chainKey: 'monad', tokenIn, tokenOut, amountInWei: 1n, sources: ['lifi', 'kyberswap'], slippageBps: 50,
      onResult: (res, snap) => seen.push([res.source, snap.pending, snap.best?.source]),
    });
    assert.deepEqual(seen, [['lifi', 1, 'lifi'], ['kyberswap', 0, 'kyberswap']]);
    assert.equal(r.pending, 0);
    assert.equal(r.best.source, 'kyberswap');
    assert.deepEqual(r.all.map((x) => x.source), ['lifi', 'kyberswap']); // asked-order, stable between runs
  } finally { restore.forEach((f) => f()); }
});
