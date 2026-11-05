// ⛽ Get gas: top up the native gas token on a chain you can't transact on yet.
// Pay with USDC on another chain; receive the native token in the same wallet.
//
// It doesn't move funds itself. It fills the Bridge form (NEAR Intents, USDC ->
// destination native) and the normal Bridge flow does the rest: quote ->
// deposit -> status. Chains marked 🔥 are delivered over HOT Protocol's bridge
// (NEAR Intents asset ids `v2_1.omni.hot.tg:*`).

import { ethers } from 'ethers';
import { GAS_CHAINS, GAS_MIN_USD, setupGasRefill, readProvider } from './bridge.js';
import { getAddress, subscribeToAccountChanges } from './utils/web3.js';

const AMOUNTS = [GAS_MIN_USD, 1, 3, 5];   // USD; GAS_MIN_USD ($0.28) is the minimum
const LOW_GAS_USD = 0.25;                 // below this, call the balance "low"
const g = id => document.getElementById(id);
const fmtUsd = n => `$${Number(n).toFixed(n < 1 ? 2 : 0)}`;

const state = { to: 'monad', from: 'base', usd: 3 };
const priceCache = {};                    // chainId -> native price in USD (from NEAR Intents)

function chip(label, active, onClick, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'src-chip' + (active ? ' active' : '');
  b.textContent = label;
  if (title) b.title = title;
  b.onclick = onClick;
  return b;
}

function payOptions() { return GAS_CHAINS.filter(c => c.payable && c.key !== state.to); }

function render() {
  const to = g('gasTo'), amt = g('gasAmt'), from = g('gasFrom');
  if (!to) return;
  to.innerHTML = ''; amt.innerHTML = '';
  for (const c of GAS_CHAINS) {
    to.appendChild(chip(`${c.hot ? '🔥 ' : ''}${c.label} · ${c.native}`, c.key === state.to, () => {
      state.to = c.key;
      if (!payOptions().some(x => x.key === state.from)) state.from = payOptions()[0].key;
      render(); showBalance();
    }, c.hot ? 'Delivered over HOT Protocol\'s bridge' : 'Delivered by NEAR Intents'));
  }
  const custom = !AMOUNTS.includes(state.usd);
  for (const usd of AMOUNTS) {
    amt.appendChild(chip(fmtUsd(usd), !custom && usd === state.usd, () => {
      state.usd = usd; g('gasCustom').value = ''; render();
    }));
  }
  from.innerHTML = '';
  for (const c of payOptions()) from.add(new Option(`USDC on ${c.label}`, c.key, false, c.key === state.from));
  const dest = GAS_CHAINS.find(c => c.key === state.to);
  g('gasGo').textContent = `Get ~$${state.usd.toFixed(2)} of ${dest.native} on ${dest.label}`;
}

async function nativePriceUsd(chainId) {
  if (chainId in priceCache) return priceCache[chainId];
  const j = await fetch(`/api/near/tokens?chainId=${chainId}`).then(r => r.json());
  const native = (j.tokens || []).find(t => !t.address);
  return (priceCache[chainId] = Number(native?.price) || null);
}

async function showBalance() {
  const el = g('gasBal');
  const addr = getAddress();
  const dest = GAS_CHAINS.find(c => c.key === state.to);
  el.className = 'gas-bal';
  if (!addr) { el.textContent = `Connect a wallet to see your ${dest.native} balance on ${dest.label}.`; return; }
  el.textContent = `Checking your ${dest.native} on ${dest.label}…`;
  const want = state.to;
  try {
    const p = await readProvider(want);
    const bal = Number(ethers.formatEther(await p.getBalance(addr)));
    if (state.to !== want) return; // user picked another chain meanwhile
    const px = await nativePriceUsd(dest.chainId).catch(() => null);
    const low = px ? bal * px < LOW_GAS_USD : bal === 0;
    const usd = px ? ` (≈ $${(bal * px).toFixed(2)})` : '';
    el.textContent = `You have ${bal.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${dest.native} on ${dest.label}${usd}${low ? '. Low: top up to transact.' : '.'}`;
    if (low) el.className = 'gas-bal low';
  } catch {
    el.textContent = `Couldn't read your ${dest.native} balance right now.`;
  }
}

function readCustom() {
  const raw = g('gasCustom').value.trim();
  if (!raw) return true;
  const v = Number(raw);
  if (!(v >= GAS_MIN_USD)) {
    g('gasMsg').textContent = `Minimum gas refill is $${GAS_MIN_USD.toFixed(2)}.`;
    return false;
  }
  state.usd = Math.round(v * 100) / 100;
  return true;
}

async function go() {
  const btn = g('gasGo'), msg = g('gasMsg');
  msg.textContent = '';
  if (!readCustom()) return;
  btn.disabled = true;
  try {
    state.from = g('gasFrom').value;
    await setupGasRefill({ toChain: state.to, fromChain: state.from, usd: state.usd });
    msg.textContent = 'Filled in below. Check the quote, then tap Bridge.';
    document.getElementById('bQuoteBox')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    msg.textContent = String(e.message || e).slice(0, 140);
  } finally {
    btn.disabled = false;
  }
}

if (g('gasCard')) {
  g('gasCustom').min = String(GAS_MIN_USD);
  g('gasCustom').placeholder = `Custom (min $${GAS_MIN_USD.toFixed(2)})`;
  render();
  showBalance();
  g('gasGo').onclick = go;
  g('gasFrom').onchange = (e) => { state.from = e.target.value; };
  g('gasCustom').addEventListener('input', () => {
    g('gasMsg').textContent = '';
    const v = Number(g('gasCustom').value);
    if (v >= GAS_MIN_USD) { state.usd = Math.round(v * 100) / 100; render(); }
  });
  subscribeToAccountChanges(showBalance);
}
