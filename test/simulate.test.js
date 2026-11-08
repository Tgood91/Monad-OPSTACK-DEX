import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation, isRevert, isInsufficientFunds } from '../src/simulate.js';

const tx = { to: '0x1', data: '0x', value: 0n, from: '0x2' };
const ok = () => ({ call: async () => '0x' });
const refuse = (msg = 'Call failed') => ({
  calls: 0,
  call: async function () {
    this.calls++;
    throw new Error(msg);
  },
});
const reverts = () => ({
  calls: 0,
  call: async function () {
    this.calls++;
    throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION', reason: 'STF' });
  },
});

test('first provider answers: ok', async () => {
  assert.deepEqual(await runSimulation([ok()], tx), { ok: true });
});
test('wallet refuses with "Call failed" but the public RPC answers: ok (the Zerion case)', async () => {
  const r = await runSimulation([refuse(), ok()], tx);
  assert.equal(r.ok, true);
  const r2 = await runSimulation([ok(), refuse()], tx);
  assert.equal(r2.ok, true);
});
test('a real revert is believed and the next provider is not consulted', async () => {
  const second = ok();
  let asked = false;
  second.call = async () => {
    asked = true;
    return '0x';
  };
  const r = await runSimulation([reverts(), second], tx);
  assert.equal(r.ok, false);
  assert.equal(r.reverted, true);
  assert.match(r.reason, /STF/);
  assert.equal(asked, false);
});
test('a refusal first, then a real revert: blocked with the real reason', async () => {
  const r = await runSimulation([refuse(), reverts()], tx);
  assert.equal(r.ok, false);
  assert.equal(r.reverted, true);
});
test('nobody can answer: not sent, and the message says we could not check (not that it would fail)', async () => {
  const r = await runSimulation([refuse('Call failed'), refuse('timeout')], tx);
  assert.equal(r.ok, false);
  assert.equal(r.reverted, false);
  assert.match(r.reason, /couldn't check this right now/);
  assert.match(r.reason, /Nothing was sent/);
});
test('no providers at all behaves the same way', async () => {
  const r = await runSimulation([], tx);
  assert.equal(r.ok, false);
  assert.equal(r.reverted, false);
});
test('isRevert only matches real reverts', () => {
  assert.equal(isRevert({ code: 'CALL_EXCEPTION' }), true);
  assert.equal(isRevert(new Error('execution reverted: STF')), true);
  assert.equal(isRevert(new Error('Call failed')), false);
  assert.equal(isRevert(new Error('network timeout')), false);
});

test('insufficient funds is its own plain answer, not "Call failed" and not a revert', async () => {
  const poor = {
    call: async () => {
      throw Object.assign(new Error('insufficient funds for transfer'), { code: 'INSUFFICIENT_FUNDS' });
    },
  };
  let asked = false;
  const next = { call: async () => ((asked = true), '0x') };
  const r = await runSimulation([poor, next], tx);
  assert.equal(r.ok, false);
  assert.equal(r.funds, true);
  assert.equal(r.reverted, false);
  assert.match(r.reason, /not enough in this wallet/);
  assert.equal(asked, false);
  assert.equal(isInsufficientFunds(new Error('Call failed')), false);
  assert.equal(isInsufficientFunds(new Error('gas required exceeds balance')), true);
});
