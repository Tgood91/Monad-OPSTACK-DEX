import test from 'node:test';
import assert from 'node:assert/strict';
import { faucetBarView, runFaucetClaim } from '../src/faucet-button.js';

const base = { enabled: true, dripMon: '0.1', connected: false, status: null, phase: 'idle', userStarted: false };
const ok = { enabled: true, dripMon: '0.1', eligible: true, available: true };

test('faucet off at the server: nothing is shown', () => {
  assert.equal(faucetBarView({ ...base, enabled: false }).show, false);
});
test('not connected: one button that connects first, and says the amount', () => {
  const v = faucetBarView(base);
  assert.equal(v.show, true);
  assert.equal(v.label, 'Connect & claim 0.1 MON free');
  assert.equal(v.disabled, false);
});
test('connected, eligible, funded: a plain claim button', () => {
  const v = faucetBarView({ ...base, connected: true, status: ok });
  assert.equal(v.label, 'Claim 0.1 MON free');
  assert.equal(v.disabled, false);
});
test('connected but status not loaded yet: still offers the claim', () => {
  assert.equal(faucetBarView({ ...base, connected: true }).label, 'Claim 0.1 MON free');
});
test('a wallet that already has gas: hidden, unless they pressed the button, then explained (amber)', () => {
  const st = { ...ok, eligible: false, reason: 'This wallet already has MON for gas.' };
  assert.equal(faucetBarView({ ...base, connected: true, status: st }).show, false);
  const v = faucetBarView({ ...base, connected: true, status: st, userStarted: true });
  assert.equal(v.show, true);
  assert.equal(v.disabled, true);
  assert.equal(v.tone, 'warn');
  assert.match(v.hint, /already has MON/);
});
test('faucet empty: disabled with a plain message, amber', () => {
  const v = faucetBarView({ ...base, connected: true, status: { ...ok, available: false } });
  assert.equal(v.disabled, true);
  assert.equal(v.tone, 'warn');
  assert.match(v.label, /empty/);
});
test('working phases are disabled; sent is green; error is amber and retryable', () => {
  assert.equal(faucetBarView({ ...base, connected: true, phase: 'checking' }).disabled, true);
  assert.equal(faucetBarView({ ...base, connected: true, phase: 'claiming' }).label, 'Sending your MON…');
  const sent = faucetBarView({ ...base, connected: true, phase: 'sent', result: { amountMon: '0.1' } });
  assert.equal(sent.tone, 'ok');
  assert.equal(sent.label, '✓ 0.1 MON sent');
  const err = faucetBarView({ ...base, connected: true, phase: 'error', error: 'Only one claim per visitor per day.' });
  assert.equal(err.tone, 'warn');
  assert.equal(err.disabled, false);
  assert.equal(err.label, 'Try again');
});

test('claim flow: eligible wallet is checked and then paid', async () => {
  const calls = [];
  const r = await runFaucetClaim('0xabc', {
    loadFaucet: async () => ok,
    claimFaucet: async (a) => (calls.push(a), { hash: '0x' + '1'.repeat(64), amountMon: '0.1' }),
  });
  assert.equal(r.state, 'sent');
  assert.equal(r.amountMon, '0.1');
  assert.deepEqual(calls, ['0xabc']);
});
test('claim flow: a wallet that does not need gas is never sent a claim', async () => {
  let claimed = false;
  const r = await runFaucetClaim('0xabc', {
    loadFaucet: async () => ({ ...ok, eligible: false, reason: 'This wallet already has activity on Monad.' }),
    claimFaucet: async () => ((claimed = true), {}),
  });
  assert.equal(r.state, 'not-eligible');
  assert.match(r.reason, /already has activity/);
  assert.equal(claimed, false);
});
test('claim flow: empty faucet is reported, no claim attempted', async () => {
  let claimed = false;
  const r = await runFaucetClaim('0xabc', {
    loadFaucet: async () => ({ ...ok, available: false }),
    claimFaucet: async () => ((claimed = true), {}),
  });
  assert.equal(r.state, 'empty');
  assert.equal(claimed, false);
});
test('claim flow: unreachable faucet and a refused claim both give plain messages and never throw', async () => {
  const down = await runFaucetClaim('0xabc', { loadFaucet: async () => null, claimFaucet: async () => ({}) });
  assert.equal(down.state, 'error');
  assert.match(down.message, /usually brief/);
  const threw = await runFaucetClaim('0xabc', { loadFaucet: async () => { throw new Error('boom'); }, claimFaucet: async () => ({}) });
  assert.equal(threw.state, 'error');
  const refused = await runFaucetClaim('0xabc', {
    loadFaucet: async () => ok,
    claimFaucet: async () => { throw new Error('Only one claim per visitor per day. Try again tomorrow.'); },
  });
  assert.equal(refused.state, 'error');
  assert.match(refused.message, /one claim per visitor/);
});
