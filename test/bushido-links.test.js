import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSHIDO_REPOS, txUrl } from '../src/bushido-links.js';
import { CHAINS } from '../src/dex/chains.js';

const H = '0x' + 'ab'.repeat(32);

test('a good hash links to the right explorer, per chain', () => {
  assert.equal(txUrl(CHAINS.monad, H), `https://monadscan.com/tx/${H}`);
  assert.equal(txUrl(CHAINS.base, H), `https://basescan.org/tx/${H}`);
});
test('no link for a malformed hash or a chain without an explorer', () => {
  assert.equal(txUrl(CHAINS.monad, '0xabc'), null);
  assert.equal(txUrl(CHAINS.monad, undefined), null);
  assert.equal(txUrl(CHAINS.monad, H + 'zz'), null);
  assert.equal(txUrl({}, H), null);
  assert.equal(txUrl(null, H), null);
});
test('a trailing slash on the explorer is handled', () => {
  assert.equal(txUrl({ explorer: 'https://x.io/' }, H), `https://x.io/tx/${H}`);
});
test('the code links are the two public Tgood91 repos with "virtuals" in the name', () => {
  assert.equal(BUSHIDO_REPOS.length, 2);
  for (const r of BUSHIDO_REPOS) {
    assert.ok(r.name.includes('virtuals'));
    assert.equal(r.url, `https://github.com/Tgood91/${r.name}`);
  }
});
