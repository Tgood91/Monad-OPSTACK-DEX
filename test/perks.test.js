import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { createPerks, makeToken, readToken, perksMessage, holdsPass, TOKEN_TTL_MS } from '../server/perks.js';
import { createLimiter } from '../server/limits.js';
import { perksMessage as clientMessage, loadPerk, savePerk, unlockPerks, installPerkHeader } from '../src/perks-client.js';

const W = ethers.Wallet.createRandom();
const T0 = 1_800_000_000_000;
const mk = (over = {}) => createPerks({ secret: 's3cret', now: () => T0, hasPass: async () => true, ...over });
const signed = async (wallet = W, issuedAt = new Date(T0).toISOString()) => ({
  address: wallet.address,
  issuedAt,
  signature: await wallet.signMessage(perksMessage(wallet.address, issuedAt)),
});

test('client and server build the identical message', () => {
  assert.equal(clientMessage(W.address, 'x'), perksMessage(W.address, 'x'));
});
test('good claim: pass holder gets a token that reads back', async () => {
  const r = await mk().claim(await signed());
  assert.equal(r.address, W.address);
  assert.deepEqual(readToken(r.token, 's3cret', T0)?.address, W.address.toLowerCase());
});
test('no pass -> refused', async () => {
  await assert.rejects(mk({ hasPass: async () => false }).claim(await signed()), /does not hold a Dojo Pass/);
});
test('signature from another wallet -> refused', async () => {
  const other = ethers.Wallet.createRandom();
  const c = await signed(other);
  await assert.rejects(mk().claim({ ...c, address: W.address }), /different wallet/);
});
test('stale or future claim -> refused (no replay)', async () => {
  await assert.rejects(mk().claim(await signed(W, new Date(T0 - 6 * 60_000).toISOString())), /too old/);
  await assert.rejects(mk().claim(await signed(W, new Date(T0 + 6 * 60_000).toISOString())), /too old/);
});
test('garbage input -> plain errors', async () => {
  await assert.rejects(mk().claim({}), /not a wallet/);
  await assert.rejects(mk().claim({ address: W.address, issuedAt: new Date(T0).toISOString(), signature: 'nope' }), /not valid/);
});
test('token: tampered, wrong secret and expired are all rejected', () => {
  const t = makeToken(W.address, T0, 's3cret');
  assert.ok(readToken(t, 's3cret', T0));
  assert.equal(readToken(t, 'other', T0), null);
  assert.equal(readToken(t, 's3cret', T0 + TOKEN_TTL_MS + 1), null);
  const [p, m] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ a: '0xdead', exp: T0 + 1e12 })).toString('base64url');
  assert.equal(readToken(`${forged}.${m}`, 's3cret', T0), null);
  assert.equal(readToken(p, 's3cret', T0), null);
  assert.equal(readToken(null, 's3cret', T0), null);
});
test('multiplier setting is bounded', () => {
  assert.equal(createPerks({ env: { PERK_QUOTE_MULTIPLIER: '5' }, secret: 'x' }).multiplier, 5);
  assert.equal(createPerks({ env: { PERK_QUOTE_MULTIPLIER: '999' }, secret: 'x' }).multiplier, 3);
  assert.equal(createPerks({ env: {}, secret: 'x' }).multiplier, 3);
});
test('limiter: a verified token raises only the quote bucket', () => {
  let now = 0;
  const lim = createLimiter({ general: 2, quotes: 2, now: () => now, perkMultiplier: (req) => (req.perk ? 3 : 1) });
  const run = (req) => {
    let code = 200;
    lim({ ip: '1.1.1.1', originalUrl: req.url, perk: req.perk }, { status: (c) => ({ json: () => (code = c) }) }, () => {});
    return code;
  };
  const q = '/api/uniswap/quote';
  assert.deepEqual([1, 2, 3].map(() => run({ url: q })), [200, 200, 429]);
  now = 61_000;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(() => run({ url: q, perk: true })), [200, 200, 200, 200, 200, 200, 429]);
  now = 122_000;
  assert.deepEqual([1, 2, 3].map(() => run({ url: '/api/faucet/status', perk: true })), [200, 200, 429]);
});
test('holdsPass reads the chain: yes, no, and RPC failure', async () => {
  const ans = (result) => async () => ({ json: async () => ({ result }) });
  assert.equal(await holdsPass(W.address, { fetchImpl: ans('0x' + '0'.repeat(63) + '1'), rpcs: ['a'] }), true);
  assert.equal(await holdsPass(W.address, { fetchImpl: ans('0x' + '0'.repeat(64)), rpcs: ['a'] }), false);
  await assert.rejects(holdsPass(W.address, { fetchImpl: async () => { throw new Error('down'); }, rpcs: ['a'] }), /could not check/);
});
test('client: unlock stores the token for that wallet only; header is added to /api only', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const server = mk();
  const fetchImpl = async (_u, o) => {
    try {
      const r = await server.claim(JSON.parse(o.body));
      return { ok: true, json: async () => r };
    } catch (e) {
      return { ok: false, status: 400, json: async () => ({ error: e.message }) };
    }
  };
  const rec = await unlockPerks(W.address, { signMessage: (m) => W.signMessage(m), fetchImpl, now: () => T0, storage });
  assert.ok(rec.token);
  assert.ok(loadPerk(W.address, { storage, now: T0 }));
  assert.equal(loadPerk('0x0000000000000000000000000000000000000001', { storage, now: T0 }), null);
  assert.equal(loadPerk(W.address, { storage, now: T0 + TOKEN_TTL_MS + 5 }), null);
  const seen = [];
  const win = { fetch: async (u, i) => seen.push([u, i?.headers?.get?.('x-perk-token')]) };
  savePerk({ ...rec, exp: Date.now() + 1e6 }, storage);
  installPerkHeader({ win, storage });
  await win.fetch('/api/uniswap/quote', {});
  await win.fetch('https://example.com/x', {});
  assert.equal(seen[0][1], rec.token);
  assert.equal(seen[1][1], undefined);
});
