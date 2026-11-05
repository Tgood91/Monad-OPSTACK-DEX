// ⛽ Get gas: top up the native gas token on a chain you can't transact on yet.
// Pay with USDC on another chain; receive MON / ETH in the same wallet.
//
// It doesn't move funds itself. It fills the Bridge form (NEAR Intents, USDC ->
// destination native) and the normal Bridge flow does the rest: quote ->
// deposit -> status. On Monad and Optimism, NEAR Intents carries the funds
// over HOT Protocol's bridge (asset ids `v2_1.omni.hot.tg:*`).

import { ethers } from 'ethers';
import { GAS_CHAINS, setupGasRefill, readProvider } from './bridge.js';
import { getAddress, subscribeToAccountChanges } from './utils/web3.js';

const AMOUNTS = [1, 3, 5];                  // USD
const LOW_GAS_USD = 0.25;                   // below this, call the balance "low"
const g = id => document.getElementById(id);

const state = { to: 'monad', from: 'base', usd: 3 };

function chip(label, active, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'src-chip' + (active ? ' active' : '');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function render() {
  const to = g('gasTo'), amt = g('gasAmt'), from = g('gasFrom');
  if (!to) return;
  to.innerHTML = ''; amt.innerHTML = '';
  for (const c of GAS_CHAINS) {
    to.appendChild(chip(`${c.label} · ${c.native}`, c.key === state.to, () => {
      state.to = c.key;
      if (state.from === state.to) state.from = GAS_CHAINS.find(x => x.key !== state.to).key;
      render(); showBalance();
    }));
  }
  for (const usd of AMOUNTS) amt.appendChild(chip(`$${usd}`, usd === state.usd, () => { state.usd = usd; render(); }));
  from.innerHTML = '';
  for (const c of GAS_CHAINS) {
    if (c.key === state.to) continue;
    from.add(new Option(`USDC on ${c.label}`, c.key, false, c.key === state.from));
  }
  const dest = GAS_CHAINS.find(c => c.key === state.to);
  g('gasGo').textContent = `Get ~$${state.usd} of ${dest.native} on ${dest.label}`;
}

async function showBalance() {
  const el = g('gasBal');
  const addr = getAddress();
  const dest = GAS_CHAINS.find(c => c.key === state.to);
  if (!addr) { el.textContent = `Connect a wallet to see your ${dest.native} balance.`; el.className = 'gas-bal'; return; }
  el.textContent = `Checking your ${dest.native} on ${dest.label}…`; el.className = 'gas-bal';
  try {
    const p = await readProvider(state.to);
    const bal = Number(ethers.formatEther(await p.getBalance(addr)));
    const shown = bal.toLocaleString(undefined, { maximumFractionDigits: 6 });
    // Rough USD check from the live price feed; skip the hint if no price.
    let low = bal === 0;
    try {
      const sym = dest.native === 'MON' ? 'MON-USD' : 'ETH-USD';
      const r = await fetch(`/api/coinbase/prices?products=${sym}`).then(x => x.json());
      const px = Number(r?.prices?.[sym]?.price);
      if (px > 0) low = bal * px < LOW_GAS_USD;
    } catch { /* price optional */ }
    el.textContent = `You have ${shown} ${dest.native} on ${dest.label}${low ? ' (low, top up to transact)' : ''}.`;
    el.className = 'gas-bal' + (low ? ' low' : '');
  } catch {
    el.textContent = `Couldn't read your ${dest.native} balance right now.`;
  }
}

async function go() {
  const btn = g('gasGo'), msg = g('gasMsg');
  btn.disabled = true; msg.textContent = '';
  try {
    state.from = g('gasFrom').value;
    await setupGasRefill({ toChain: state.to, fromChain: state.from, usd: state.usd });
    msg.textContent = 'Filled in below. Check the quote, then tap Bridge.';
    document.getElementById('bQuoteBox')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    msg.textContent = String(e.message || e).slice(0, 120);
  } finally {
    btn.disabled = false;
  }
}

if (g('gasCard')) {
  render();
  showBalance();
  g('gasGo').onclick = go;
  g('gasFrom').onchange = (e) => { state.from = e.target.value; };
  subscribeToAccountChanges(showBalance);
}
