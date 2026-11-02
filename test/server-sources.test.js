// Server-side quote sources: request format and response parsing, with fetch
// mocked (no network, no real keys). Regression tests for fixed bugs.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
let calls;
function mockFetch(responder) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const body = responder(String(url), opts);
    return { ok: true, status: 200, json: async () => body };
  };
}
beforeEach(() => { process.env.UNISWAP_API_KEY = 'test-key'; process.env.ZERION_API_KEY = 'zk_test'; });
afterEach(() => { globalThis.fetch = realFetch; });

test('Uniswap: slippage is sent as a percent (50 bps -> 0.5), not bps', async () => {
  const { uniswapQuote } = await import('../server/uniswap.js');
  mockFetch(() => ({ routing: 'CLASSIC', quote: { output: { amount: '22518100', minimumAmount: '22405500' } } }));
  await uniswapQuote({ chainId: 8453, tokenIn: '0x4200000000000000000000000000000000000006', tokenOut: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amountAtomic: '10000000000000000', taker: '0x0000000000000000000000000000000000000001', slippageBps: 50 });
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.slippageTolerance, 0.5);
  assert.equal(calls[0].opts.headers['x-api-key'], 'test-key');
});

test('Zerion: amountOut is the token quantity, not the USD-only after-fees object', async () => {
  const { zerionQuote } = await import('../server/zerion.js');
  mockFetch(() => ({ data: [{ attributes: {
    output_amount: { quantity: '22.510385', value: 22.5, usd_value: 22.5, currency: 'USD' },
    minimum_output_amount: { quantity: '22.397833' },
    output_amount_after_fees: { value: 22.21, usd_value: 22.21, currency: 'USD' },
    transaction_swap: { evm: { to: '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85', data: '0xabcdef', value: '0' } },
  } }] }));
  const q = await zerionQuote({ chainId: 1, tokenIn: 'eth', tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amountHuman: '0.01', slippageBps: 50 });
  assert.equal(q.amountOut, '22.510385');
  assert.equal(q.minAmountOut, '22.397833');
  assert.equal(q.amountOutUsd, 22.21);
  assert.equal(q.to, '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85');
  assert.match(calls[0].url, /slippage_percent=0\.5/);
  assert.match(calls[0].opts.headers.Authorization, /^Basic /);
});

test('Zerion: BNB uses Zerion\'s chain id "binance-smart-chain"', async () => {
  const { ZERION_CHAINS } = await import('../server/zerion.js');
  assert.equal(ZERION_CHAINS[56], 'binance-smart-chain');
});
