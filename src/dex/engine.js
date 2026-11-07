// Quote engine: parallel fan-out, per-source timeout, normalized best-wins.
// A source failing never breaks the batch — its reason is reported inline.

import { ADAPTERS, adapterKeySet } from './adapters.js';
import { QUOTE_TIMEOUT_MS } from './chains.js';
import { resilient } from './resilience.js';

function withTimeout(promise, ms, label) {
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout (${label})`)), ms));
  return Promise.race([promise, t]);
}

// Rank the finished results: best amountOut first.
function rank(results) {
  const good = results.filter((r) => r.ok).sort((a, b) => (a.quote.amountOut < b.quote.amountOut ? 1 : -1));
  return { all: results, good, best: good[0] || null };
}

/**
 * Ask every source at once.
 *  - A source that cannot serve this pair (or is switched off) is skipped without a call:
 *    its result carries `skipped: true` and the UI leaves it out.
 *  - `onResult(result, snapshot)` fires as EACH source finishes, with the ranking so far
 *    and `pending` = how many are still out, so the UI can show fast quotes immediately.
 *  - The returned value is the final snapshot (pending = 0).
 */
export async function quoteAll({
  chainKey, tokenIn, tokenOut, amountInWei, wallet, sources, slippageBps, disabled = new Set(), onResult,
}) {
  const done = [];
  let outstanding = sources.length;
  const snapshot = () => ({ ...rank(done), pending: outstanding });
  const finish = (result) => {
    done.push(result);
    outstanding -= 1;
    onResult?.(result, snapshot());
    return result;
  };

  const jobs = sources.map((src) =>
    (async () => {
      if (disabled.has(src)) return finish({ source: src, ok: false, skipped: true, reason: 'turned off' });
      const why = ADAPTERS[src].canQuote?.(chainKey, tokenIn, tokenOut, wallet);
      if (why) return finish({ source: src, ok: false, skipped: true, reason: why });
      if (!adapterKeySet(src)) return finish({ source: src, ok: false, reason: 'API key not set' });
      try {
        const q = await resilient(`swap:${src}`, () =>
          withTimeout(
            ADAPTERS[src].quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps),
            QUOTE_TIMEOUT_MS,
            src,
          ),
        );
        if (!q || q.amountOut <= 0n) return finish({ source: src, ok: false, reason: 'no liquidity' });
        return finish({ source: src, ok: true, quote: { ...q, chainKey, tokenIn, tokenOut, amountInWei } });
      } catch (e) {
        return finish({ source: src, ok: false, reason: (e.message || 'error').slice(0, 80) });
      }
    })(),
  );

  await Promise.all(jobs);
  // Final list in the order the sources were asked, so rows don't jump between runs.
  const byOrder = sources.map((src) => done.find((r) => r.source === src));
  return { ...rank(byOrder), pending: 0 };
}

export async function buildTxFor(quote, wallet, slippageBps, signer) {
  const adapter = ADAPTERS[quote.source];
  if (!adapter) throw new Error(`No adapter for ${quote.source}`);
  return adapter.buildTx(quote, wallet, slippageBps, signer);
}
