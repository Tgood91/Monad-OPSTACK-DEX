import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { CHAINS } from '../src/dex/chains.js';
import { swapSetup } from '../src/bushido-swap.js';

const toks = CHAINS.monad.tokens;

test('MON and USDC stay first, so the app defaults do not move', () => {
  assert.deepEqual(toks.slice(0, 2).map((t) => t.symbol), ['MON', 'USDC']);
  assert.equal(toks[0].isNative, true);
});
test('Monad lists the verified extra tokens', () => {
  for (const s of ['USDT0', 'WETH', 'WBTC', 'AUSD', 'sMON', 'gMON', 'shMON', 'GHO', 'cbBTC', 'LBTC', 'Cake', 'avUSD', 'mUSD', 'XAUt0', 'aprMON', 'syrupUSDC', 'WMON', 'MONAZ']) assert.ok(toks.find((t) => t.symbol === s), s);
});
test('every address is a valid checksummed address, with sane decimals, and no duplicates', () => {
  const seen = new Set();
  for (const t of toks) {
    assert.equal(ethers.getAddress(t.address), t.address, `${t.symbol} checksum`);
    assert.ok(Number.isInteger(t.decimals) && t.decimals >= 6 && t.decimals <= 18, t.symbol);
    // The only allowed repeat is MON + WMON: native MON is represented by the WMON contract address.
    if (t.symbol !== 'WMON') assert.ok(!seen.has(t.address.toLowerCase()), `duplicate ${t.symbol}`);
    assert.ok(!seen.has(t.symbol), `duplicate symbol ${t.symbol}`);
    seen.add(t.address.toLowerCase());
    seen.add(t.symbol);
  }
});
test('the Bushido swap panel still pairs MON with USDC', () => {
  const s = swapSetup('monad');
  assert.equal(s.tIn.symbol, 'MON');
  assert.equal(s.tOut.symbol, 'USDC');
});

test('WMON is a plain token on the same contract as the MON placeholder', () => {
  const mon = toks.find((t) => t.symbol === 'MON');
  const w = toks.find((t) => t.symbol === 'WMON');
  assert.equal(w.address, mon.address);
  assert.ok(mon.isNative && !w.isNative);
});
