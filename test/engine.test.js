// Quote engine: fan-out, best-wins ranking, per-source failure isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS } from '../src/dex/adapters.js';
import { quoteAll } from '../src/dex/engine.js';

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
