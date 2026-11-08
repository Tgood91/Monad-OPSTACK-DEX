// The "Connect & claim free MON" button: what it says in every situation, and the claim flow behind it.
// Pure logic (no DOM, no wallet) so each state is unit-tested; the wiring is in faucet-button-ui.js.

/** First letter up, for server reasons like "this wallet already has MON for gas." */
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());

/**
 * s = {
 *   enabled,         // the faucet is switched on at the server
 *   dripMon,         // "0.1", if known
 *   connected,       // a wallet is connected
 *   status,          // /api/faucet/status for the connected wallet, or null while unknown
 *   phase,           // 'idle' | 'checking' | 'claiming' | 'sent' | 'error'
 *   userStarted,     // the visitor has pressed the button (so we may explain why they can't claim)
 *   result,          // { hash, amountMon } after a claim
 *   error,           // plain-language message after a failure
 * }
 * -> { show, label, disabled, hint, tone: 'normal' | 'ok' | 'warn' }
 */
export function faucetBarView(s) {
  const hide = { show: false, label: '', disabled: true, hint: '', tone: 'normal' };
  if (!s.enabled) return hide;
  const amount = s.dripMon ? `${s.dripMon} MON` : 'MON';

  if (s.phase === 'sent') {
    return {
      show: true,
      label: `✓ ${s.result?.amountMon ?? s.dripMon ?? ''} MON sent`.replace('  ', ' '),
      disabled: true,
      hint: 'Give it a few seconds, then swap or enter the Dojo.',
      tone: 'ok',
    };
  }
  if (s.phase === 'claiming')
    return { show: true, label: 'Sending your MON…', disabled: true, hint: '', tone: 'normal' };
  if (s.phase === 'checking')
    return { show: true, label: 'Checking your wallet…', disabled: true, hint: '', tone: 'normal' };
  if (s.phase === 'error')
    return { show: true, label: 'Try again', disabled: false, hint: s.error || 'Something went wrong.', tone: 'warn' };

  if (!s.connected) {
    return {
      show: true,
      label: `Connect & claim ${amount} free`,
      disabled: false,
      hint: 'New to Monad? Free gas to get you started.',
      tone: 'normal',
    };
  }

  const st = s.status;
  if (!st) return { show: true, label: `Claim ${amount} free`, disabled: false, hint: '', tone: 'normal' };
  if (!st.eligible) {
    // A wallet that already has gas doesn't need this: stay out of the way unless they asked.
    return s.userStarted
      ? { show: true, label: 'No claim needed', disabled: true, hint: cap(st.reason), tone: 'warn' }
      : hide;
  }
  if (st.available === false)
    return {
      show: true,
      label: 'Faucet is empty right now',
      disabled: true,
      hint: 'Please try again later.',
      tone: 'warn',
    };
  return {
    show: true,
    label: `Claim ${st.dripMon ? st.dripMon + ' MON' : amount} free`,
    disabled: false,
    hint: '',
    tone: 'normal',
  };
}

/**
 * Check the wallet, then claim. Never throws: every outcome is a plain object.
 *   { state: 'sent', hash, amountMon } | { state: 'not-eligible', reason, status }
 *   | { state: 'empty', status } | { state: 'error', message }
 */
export async function runFaucetClaim(address, { loadFaucet, claimFaucet }) {
  let status;
  try {
    status = await loadFaucet(address);
  } catch {
    status = null;
  }
  if (!status) return { state: 'error', message: "Can't reach the faucet right now. This is usually brief." };
  if (!status.eligible)
    return { state: 'not-eligible', reason: status.reason || 'This wallet does not need a claim.', status };
  if (status.available === false) return { state: 'empty', status };
  try {
    const r = await claimFaucet(address);
    return { state: 'sent', hash: r.hash || r.txHash || null, amountMon: r.amountMon ?? status.dripMon ?? null };
  } catch (e) {
    return { state: 'error', message: String(e?.message || e).slice(0, 160) };
  }
}
