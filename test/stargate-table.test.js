import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { STARGATE_CHAINS, resolvePool, stargateTokens } from '../server/stargate.js';

// Guards the hand-copied Stargate pool/token table. Each of these was once wrong in production: nine of fifteen
// token addresses were typo'd, truncated or badly cased, and BNB Chain's stablecoins were given 6 decimals.

test('every chain, pool and token address is a valid, correctly checksummed address', () => {
  for (const chainId of STARGATE_CHAINS) {
    for (const ref of ['USDC', 'USDT', 'NATIVE']) {
      const r = resolvePool(chainId, ref);
      if (!r) continue;
      assert.equal(ethers.getAddress(r.pool), r.pool, `${chainId} ${ref} pool`);
      if (r.token !== null) assert.equal(ethers.getAddress(r.token), r.token, `${chainId} ${ref} token`);
    }
  }
});

test('the token list the app receives agrees with the pool table', () => {
  for (const chainId of STARGATE_CHAINS) {
    for (const t of stargateTokens(chainId)) {
      const r = resolvePool(chainId, t.ref);
      assert.equal(t.address, r.token, `${chainId} ${t.ref} address`);
      assert.equal(t.decimals, r.decimals, `${chainId} ${t.ref} decimals`);
    }
  }
});

test("BNB Chain's USDC and USDT are 18 decimals; everywhere else stablecoins are 6; native is 18", () => {
  for (const ref of ['USDC', 'USDT']) assert.equal(resolvePool(56, ref).decimals, 18, `BNB ${ref}`);
  for (const chainId of STARGATE_CHAINS.filter((c) => c !== 56)) {
    for (const ref of ['USDC', 'USDT']) {
      const r = resolvePool(chainId, ref);
      if (r) assert.equal(r.decimals, 6, `${chainId} ${ref}`);
    }
  }
  for (const chainId of STARGATE_CHAINS) {
    const n = resolvePool(chainId, 'NATIVE');
    if (n) assert.equal(n.decimals, 18);
  }
});

test('the verified on-chain token addresses (read from each pool) are the ones in the table', () => {
  const verified = {
    '1 USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '10 USDC': '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    '10 USDT': '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    '56 USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    '56 USDT': '0x55d398326f99059fF775485246999027B3197955',
    '42161 USDC': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    '42161 USDT': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    '43114 USDC': '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    '43114 USDT': '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
  };
  for (const [k, addr] of Object.entries(verified)) {
    const [chainId, ref] = k.split(' ');
    assert.equal(resolvePool(chainId, ref).token, addr, k);
  }
});
