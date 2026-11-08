// Wires the faucet banner + button (index.html #faucetBar) to the wallet and the server.
// The button does the whole job: connect the wallet if needed, then check eligibility and claim. It only
// appears when the faucet is switched on, and hides itself for wallets that already have gas.
import { faucetBarView, runFaucetClaim } from './faucet-button.js';
import { loadFaucet, claimFaucet } from './dojo/dojo-core.js';
import { getAddress, isConnected, openConnect, subscribeToAccountChanges } from './utils/web3.js';
import { CHAINS } from './dex/chains.js';
import { txUrl } from './bushido-links.js';
import { retryOnce } from './utils/retry.js';

const PROBE = '0x000000000000000000000000000000000000dEaD'; // only used to read the drip amount
const PENDING_MS = 2 * 60 * 1000; // a press on "Connect & claim" stays armed for 2 minutes

export function initFaucetButton(doc = document) {
  const bar = doc.getElementById('faucetBar');
  const btn = doc.getElementById('faucetBtn');
  const hint = doc.getElementById('faucetHint');
  if (!bar || !btn || !hint) return;

  const s = {
    enabled: false,
    dripMon: null,
    status: null,
    phase: 'idle',
    userStarted: false,
    result: null,
    error: '',
    pendingUntil: 0,
    lastAddr: null,
  };

  function render() {
    const connected = isConnected();
    const v = faucetBarView({ ...s, connected });
    bar.hidden = !v.show;
    btn.textContent = v.label;
    btn.disabled = v.disabled;
    hint.className = `faucet-hint ${v.tone}`;
    hint.textContent = v.hint;
    if (s.phase === 'sent' && s.result?.hash) {
      const url = txUrl(CHAINS.monad, s.result.hash);
      if (url) {
        const a = doc.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = ' View transaction';
        hint.appendChild(a);
      }
    }
  }

  async function refreshStatus(addr) {
    try {
      const st = await retryOnce(() => loadFaucet(addr));
      if (getAddress() === addr) s.status = st;
    } catch {
      /* the button still works: the claim re-checks */
    }
    render();
  }

  async function doClaim(addr) {
    s.userStarted = true;
    s.pendingUntil = 0;
    s.phase = 'checking';
    s.error = '';
    render();
    const r = await runFaucetClaim(addr, { loadFaucet, claimFaucet });
    if (getAddress() !== addr) return; // they switched wallets meanwhile
    if (r.state === 'sent') {
      s.phase = 'sent';
      s.result = { hash: r.hash, amountMon: r.amountMon };
      window.dispatchEvent(new CustomEvent('bushido:faucet-sent', { detail: { address: addr } }));
    } else if (r.state === 'error') {
      s.phase = 'error';
      s.error = r.message;
    } else {
      s.phase = 'idle';
      s.status = r.status;
    }
    render();
  }

  btn.addEventListener('click', () => {
    if (!isConnected()) {
      s.userStarted = true;
      s.pendingUntil = Date.now() + PENDING_MS;
      render();
      openConnect();
      return;
    }
    doClaim(getAddress());
  });

  subscribeToAccountChanges(() => {
    const addr = isConnected() ? getAddress() : null;
    if (addr === s.lastAddr) return;
    s.lastAddr = addr;
    s.status = null;
    s.result = null;
    s.error = '';
    s.phase = 'idle';
    if (!addr) return render();
    if (Date.now() < s.pendingUntil) doClaim(addr); // they pressed "Connect & claim": finish the job
    else {
      s.userStarted = false;
      render();
      refreshStatus(addr);
    }
  });

  (async () => {
    try {
      const h = await (await fetch('/api/health')).json();
      if (!h?.keys?.faucet) return;
      s.enabled = true;
      const probe = await loadFaucet(PROBE);
      s.dripMon = probe?.dripMon || null;
    } catch {
      return; // faucet unreachable: stay hidden, nothing to say
    }
    if (isConnected()) {
      s.lastAddr = getAddress();
      refreshStatus(s.lastAddr);
    }
    render();
  })();
}
