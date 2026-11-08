#!/usr/bin/env node
// Read-only check of the hand-written chain table (src/dex/chains.js) against the real chains.
// Nothing is sent or signed. Run it after adding or editing a chain or a coin:
//
//   npm run verify:chains                 # every chain
//   npm run verify:chains -- --chain bsc  # one chain
//   npm run verify:chains -- --prices     # also price each coin through KyberSwap (chains that list it)
//
// What it checks, per chain:
//   RPCs     each endpoint answers and reports the chain ID in the table
//   tokens   an address that has contract code; decimals equal to the table (a mismatch FAILS: this is the bug that
//            broke Stargate from BNB Chain); symbol differing from the table is only a note (names vary)
//   native   the "native" entry's address is the wrapped-native contract (WMON, WBNB, ...) and has code
//   prices   (--prices) a route from the wrapped native coin at two sizes; loss above 0.5% / 0.25% is flagged
//
// Exit code: 0 when nothing FAILED (notes and flags don't fail), 1 otherwise.
// Network flakiness: a failed lookup is retried once; public RPCs and KyberSwap rate-limit, so it runs one at a time.

import { ethers } from 'ethers';
import { CHAINS } from '../src/dex/chains.js';

const args = process.argv.slice(2);
const only = args.includes('--chain') ? args[args.indexOf('--chain') + 1] : null;
const withPrices = args.includes('--prices');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`${what} timed out`)), ms))]);
async function twice(fn) {
  try {
    return await fn();
  } catch {
    await sleep(700);
    return fn();
  }
}

const ABI = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];
let failed = 0;
const fail = (msg) => {
  failed++;
  console.log(`  FAIL  ${msg}`);
};
const note = (msg) => console.log(`  note  ${msg}`);
const ok = (msg) => console.log(`  ok    ${msg}`);

for (const [key, chain] of Object.entries(CHAINS)) {
  if (only && key !== only) continue;
  console.log(`\n== ${chain.label} (${key}, chain ${chain.chainId})`);

  // 1. RPCs: find the first that answers with the right chain ID, and keep it for the token reads
  let provider = null;
  for (const url of chain.rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(url, chain.chainId, { staticNetwork: true });
      const id = Number(await twice(() => withTimeout(p.send('eth_chainId', []), 8000, 'eth_chainId')));
      if (id !== chain.chainId) {
        fail(`RPC ${url} reports chain ${id}, table says ${chain.chainId}`);
        p.destroy();
        continue;
      }
      ok(`RPC ${url}`);
      provider ||= p;
    } catch (e) {
      note(`RPC ${url} did not answer (${String(e.message).slice(0, 40)})`);
    }
  }
  if (!provider) {
    fail('no RPC answered: cannot check tokens');
    continue;
  }
  if (chain.rpcs.length < 2) note('only one RPC listed: no fallback if it goes down');

  // 2. tokens
  for (const t of chain.tokens) {
    const label = `${t.symbol}${t.isNative ? ' (native, wrapped address)' : ''}`;
    try {
      let valid = true;
      try {
        valid = ethers.getAddress(t.address) === t.address; // throws on a bad mixed-case checksum
      } catch {
        valid = false;
      }
      if (!valid) {
        fail(`${label}: ${t.address} is not a valid, correctly checksummed address`);
        continue;
      }
      const code = await twice(() => withTimeout(provider.getCode(t.address), 8000, 'getCode'));
      if (code === '0x') {
        fail(`${label}: no contract at ${t.address}`);
        continue;
      }
      const c = new ethers.Contract(t.address, ABI, provider);
      const dec = Number(await twice(() => withTimeout(c.decimals(), 8000, 'decimals')));
      const sym = await twice(() => withTimeout(c.symbol(), 8000, 'symbol')).catch(() => '?');
      if (dec !== t.decimals) fail(`${label}: table says ${t.decimals} decimals, chain says ${dec}`);
      else if (!t.isNative && sym !== t.symbol) {
        ok(`${label}: ${dec} decimals`);
        note(`${label}: on-chain symbol is "${sym}" (table label differs; fine if intentional)`);
      } else ok(`${label}: ${dec} decimals${t.isNative ? ` (wrapped contract is "${sym}")` : ''}`);
    } catch (e) {
      note(`${label}: could not read (${String(e.shortMessage || e.message).slice(0, 50)})`);
    }
  }

  // 3. prices (optional): wrapped native -> each coin, two sizes, through KyberSwap
  if (withPrices && chain.kyberName) {
    const wn = chain.tokens[0];
    const price = async (tok, amount) => {
      const u = `https://aggregator-api.kyberswap.com/${chain.kyberName}/api/v1/routes?tokenIn=${wn.address}&tokenOut=${tok.address}&amountIn=${amount}`;
      for (let i = 0; i < 3; i++) {
        try {
          const j = await (
            await fetch(u, { headers: { 'x-client-id': 'bushido-dapp' }, signal: AbortSignal.timeout(20000) })
          ).json();
          if (j.data?.routeSummary) return j.data.routeSummary;
          if (j.code !== 429) return null;
        } catch {
          /* retry */
        }
        await sleep(1500);
      }
      return null;
    };
    for (const t of chain.tokens.slice(1)) {
      const small = await price(t, ethers.parseUnits('1', 17)); // 0.1 of the native coin
      await sleep(500);
      const big = await price(t, ethers.parseUnits('10', 17)); // 1 native coin
      await sleep(500);
      const loss = (r) => (r ? (1 - r.amountOutUsd / r.amountInUsd) * 100 : null);
      const [ls, lb] = [loss(small), loss(big)];
      if (ls === null && lb === null) note(`${t.symbol}: no KyberSwap route (may still work through another source)`);
      else {
        const flag =
          (ls !== null && Math.abs(ls) > 0.5) || (lb !== null && Math.abs(lb) > 0.25)
            ? '  <-- thin: check before offering'
            : '';
        console.log(
          `  price ${t.symbol.padEnd(8)} small ${ls === null ? 'n/a' : ls.toFixed(2) + '%'} | larger ${lb === null ? 'n/a' : lb.toFixed(2) + '%'}${flag}`,
        );
      }
    }
  }
  provider.destroy();
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nNo failures.');
process.exit(failed ? 1 : 0);
