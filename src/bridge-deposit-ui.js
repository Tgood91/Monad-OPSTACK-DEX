// Draws the "review before you pay" box for a NEAR Intents bridge (see bridge-deposit.js for the rules).
// The one-click send button stays off until NEAR itself confirms the deposit address is tied to YOUR wallet.
import { checkWithNear, chunkAddress, depositView, esc } from './bridge-deposit.js';

export function mountDeposit({
  box,
  intent,
  wallet,
  fromChain,
  toChain,
  onSend,
  onVerified = () => {},
  fetchImpl,
  sleep,
}) {
  const v = depositView({ intent, wallet, fromChain, toChain });
  const addr = intent.depositAddress; // already validated as a 0x address by the server and the caller
  const contract = v.tokenContract
    ? `Token: ${esc(intent.fi.symbol)} contract <span class="mono">${esc(v.tokenContract)}</span>. A token with the same name but another contract is a fake.`
    : `Token: the chain's own coin (${esc(intent.fi.symbol)}), not a token.`;

  box.innerHTML = `<div class="deposit-box dep">
    <div class="dep-title">Review before you pay</div>
    <div class="detail-grid">
      <span class="k">You send</span><span class="v">${esc(v.send)} on ${esc(v.sendChain)}</span>
      <span class="k">You receive</span><span class="v">${esc(v.receive)} on ${esc(v.receiveChain)}${v.min ? `<br><small class="muted">at least ${esc(v.min)}</small>` : ''}</span>
      <span class="k">Goes to</span><span class="v">${esc(v.to)} (your wallet)</span>
      <span class="k">If it fails</span><span class="v">Refunded to ${esc(v.refund)}${v.refundFee ? `<br><small class="muted">refund fee ${esc(v.refundFee)}</small>` : ''}</span>
      <span class="k">Time</span><span class="v">${esc(v.eta)}</span>
      <span class="k">Provider</span><span class="v">NEAR Intents, one-time address</span>
    </div>
    ${v.deadlineText ? `<div class="dep-note">${esc(v.deadlineText)}.</div>` : ''}
    <div class="dep-why"><b>Why does my wallet need the funds?</b> ${esc(v.why)}</div>
    <div class="dep-check" data-state="checking" role="status"></div>
    <button class="btn btn-bridge" id="bSendDepositBtn" disabled>Send deposit from wallet</button>
    <details class="dep-adv" hidden>
      <summary>Advanced: send it manually instead</summary>
      <div class="dep-note">Only send <b>exactly ${esc(v.send)}</b> on <b>${esc(v.sendChain)}</b>. ${contract}</div>
      <div class="addr" id="bDepAddr"></div>
      <div class="dep-note">Copy it from here, never from your wallet history: scammers send fake transfers so a look-alike address shows up there. Compare the first and last 6 characters before you confirm.</div>
      <button class="btn btn-secondary" id="bCopyAddrBtn">Copy address</button>
      <div class="dep-note" id="bCopyNote"></div>
    </details>
  </div>`;

  const q = (sel) => box.querySelector(sel);
  const check = q('.dep-check');
  const send = q('#bSendDepositBtn');
  const adv = q('.dep-adv');
  send.onclick = onSend;
  q('#bCopyAddrBtn').onclick = () => {
    navigator.clipboard?.writeText(addr);
    q('#bCopyNote').textContent =
      "Copied. Paste it into your wallet's send screen and compare the first and last 6 characters.";
  };

  async function run() {
    check.dataset.state = 'checking';
    check.innerHTML = '<span class="spinner"></span>Checking this address with NEAR…';
    send.disabled = true;
    adv.hidden = true;
    q('#bDepAddr').textContent = ''; // the address is not on the page until NEAR has confirmed it
    onVerified(false);
    const res = await checkWithNear(
      { depositAddress: addr, wallet, amountAtomic: intent.amountAtomic, fromTokenAddress: intent.fi.address || null },
      { fetchImpl, sleep },
    );
    check.dataset.state = res.state;
    if (res.state === 'verified') {
      check.innerHTML = `✓ Checked with NEAR: the receiving address and the refund address are your wallet, and the amount matches.${res.feeBps ? ` Includes NEAR's ${esc(res.feeBps / 100)}% fee.` : ''}`;
      send.disabled = false;
      q('#bDepAddr').textContent = chunkAddress(addr);
      q('#bDepAddr').title = addr;
      adv.hidden = false;
      onVerified(true);
    } else if (res.state === 'mismatch') {
      check.innerHTML = `✕ <b>Do not pay this address.</b> NEAR's own record does not match: ${esc(res.problems.join('; '))}. Nothing was sent. Go back and start again.`;
    } else {
      check.innerHTML = `Couldn't check with NEAR (${esc(res.problems[0])}). Nothing is sent until the check passes. <button class="btn btn-secondary dep-retry">Check again</button>`;
      check.querySelector('.dep-retry').onclick = run;
    }
    return res;
  }
  return run();
}
