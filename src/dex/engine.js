// Quote engine: parallel fan-out, per-source timeout, normalized best-wins.
// A source failing never breaks the batch — its reason is reported inline.

import { ADAPTERS, adapterKeySet } from './adapters.js';
import { QUOTE_TIMEOUT_MS } from './chains.js';

function withTimeout(promise, ms, label) {
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout (${label})`)), ms));
  return Promise.race([promise, t]);
}

export async function quoteAll({ chainKey, tokenIn, tokenOut, amountInWei, wallet, sources, slippageBps }) {
  const jobs = sources.map(src => (async () => {
    if (!adapterKeySet(src)) {
      return { source: src, ok: false, reason: 'API key not set' };
    }
    try {
      const q = await withTimeout(
        ADAPTERS[src].quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps),
        QUOTE_TIMEOUT_MS,
        src,
      );
      if (!q || q.amountOut <= 0n) return { source: src, ok: false, reason: 'no liquidity' };
      return { source: src, ok: true, quote: { ...q, chainKey, tokenIn, tokenOut, amountInWei } };
    } catch (e) {
      return { source: src, ok: false, reason: (e.message || 'error').slice(0, 80) };
    }
  })());

  const results = await Promise.all(jobs);
  const good = results.filter(r => r.ok).sort((a, b) => (a.quote.amountOut < b.quote.amountOut ? 1 : -1));
  return { all: results, good, best: good[0] || null };
}

export async function buildTxFor(quote, wallet, slippageBps, signer) {
  const adapter = ADAPTERS[quote.source];
  if (!adapter) throw new Error(`No adapter for ${quote.source}`);
  return adapter.buildTx(quote, wallet, slippageBps, signer);
}
