// Multi-Chain DEX — main entry.
// Chains/sources are config-driven (see src/dex/chains.js). Wallet via AppKit.

import { ethers } from 'ethers';
import { appKit } from './config.js';
import { CHAINS, SOURCE_META, getChain } from './dex/chains.js';
import { ADAPTERS } from './dex/adapters.js';
import { quoteAll, buildTxFor } from './dex/engine.js';
import {
  getAddress, isConnected, getChainKey, getSigner, getWalletEthersProvider,
  getReadProvider, getTokenBalance, getAllowance, approveToken, simulateTx,
  switchNetwork, formatAddress, subscribeToAccountChanges, subscribeToNetworkChanges,
  openConnect,
} from './utils/web3.js';
import { showStatus, showLoading, clearStatus, fmtAmount, fmtUsd, setButtonLoading, el } from './utils/ui.js';
import { ERC20_ABI } from './utils/abis.js';

/* ---------------- state ---------------- */
let chainKey = 'celo';
let enabledSources = new Set(['velodrome', 'uniswap', 'kyberswap', 'lifi', 'velora', 'oneinch', 'zerox', 'zerion']);
let quotes = null;
let selectedQuote = null;
let quoteTimer = null;
let slippageBps = 50;

const $ = id => document.getElementById(id);

/* ---------------- rendering ---------------- */
function renderChains() {
  const g = $('chainGrid');
  g.innerHTML = '';
  for (const [key, c] of Object.entries(CHAINS)) {
    const b = el('button', 'chain-btn' + (key === chainKey ? ' active' : ''),
      `<span class="dot" style="background:${c.color}"></span>${c.label}`);
    b.onclick = () => switchChainUI(key);
    g.appendChild(b);
  }
}

function renderSources() {
  const row = $('srcRow');
  row.innerHTML = '';
  for (const src of getChain(chainKey).sources) {
    const m = SOURCE_META[src];
    const needsKey = ['oneinch', 'zerox', 'zerion'].includes(src);
    const keySet = !needsKey || !!ADAPTERS[src].key?.();
    const chip = el('button',
      'src-chip' + (enabledSources.has(src) ? ' active' : ' off') + (keySet ? '' : ' no-key'),
      `${m.label}${keySet ? '' : ' 🔑'}`);
    chip.title = `${m.tag}${keySet ? '' : ' — API key not set (see .env)'}`;
    chip.onclick = () => {
      enabledSources.has(src) ? enabledSources.delete(src) : enabledSources.add(src);
      renderSources();
      scheduleQuote();
    };
    row.appendChild(chip);
  }
}

function renderTokens() {
  const toks = getChain(chainKey).tokens;
  for (const id of ['fromToken', 'toToken']) {
    $(id).innerHTML = '';
    toks.forEach((t, i) => $(id).add(new Option(t.symbol, i)));
  }
  $('fromToken').selectedIndex = 0;
  $('toToken').selectedIndex = Math.min(1, toks.length - 1);
}

function selTokens() {
  const toks = getChain(chainKey).tokens;
  return { in: toks[$('fromToken').value], out: toks[$('toToken').value] };
}

function updateWalletUI() {
  const addr = getAddress();
  if (addr) {
    $('connectBtn').textContent = formatAddress(addr);
    const ck = getChainKey();
    $('networkStatus').textContent = ck ? `${getChain(ck).label} ✓` : 'Unknown network';
  } else {
    $('connectBtn').textContent = 'Connect';
    $('networkStatus').textContent = 'Not connected';
  }
}

/* ---------------- chain switching ---------------- */
async function switchChainUI(key) {
  chainKey = key;
  renderChains();
  renderSources();
  renderTokens();
  $('fromAmount').value = '';
  $('toAmount').value = '';
  quotes = null;
  selectedQuote = null;
  $('quoteBox').innerHTML = '<div class="status">Enter an amount to compare quotes</div>';
  $('quoteDetail').innerHTML = '';
  $('swapBtn').disabled = true;
  $('swapBtn').textContent = 'Enter an amount';
  clearStatus();
  if (isConnected()) {
    try { await switchNetwork(key); } catch (e) { showStatus('Network switch failed: ' + e.message.slice(0, 80), 'error'); }
  }
  updateBalances();
  scheduleQuote();
}

/* ---------------- balances ---------------- */
async function updateBalances() {
  const addr = getAddress();
  if (!addr) { $('fromBalance').textContent = 'Balance: —'; $('toBalance').textContent = 'Balance: —'; return; }
  const { in: tIn, out: tOut } = selTokens();
  const cfg = getChain(chainKey);
  let rp;
  try { rp = getWalletEthersProvider(); } catch { rp = await getReadProvider(chainKey); }
  for (const [tok, elId] of [[tIn, 'fromBalance'], [tOut, 'toBalance']]) {
    try {
      const c = new ethers.Contract(tok.address, ERC20_ABI, rp);
      const [wrapped, dec] = await Promise.all([c.balanceOf(addr), c.decimals().catch(() => tok.decimals)]);
      let label = `${fmtAmount(wrapped, Number(dec))} ${tok.symbol}`;
      if (tok.isNative) {
        const native = await rp.getBalance(addr);
        label = `${fmtAmount(native, 18)} ${cfg.native} (+${fmtAmount(wrapped, Number(dec))} wrapped)`;
      }
      $(elId).textContent = 'Balance: ' + label;
    } catch { $(elId).textContent = 'Balance: —'; }
  }
}

/* ---------------- quoting ---------------- */
function scheduleQuote() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(refreshQuotes, 700);
}

async function refreshQuotes() {
  const box = $('quoteBox'), detail = $('quoteDetail'), swapBtn = $('swapBtn'), approveBtn = $('approveBtn');
  approveBtn.style.display = 'none';
  selectedQuote = null;
  const amtStr = $('fromAmount').value;
  const { in: tIn, out: tOut } = selTokens();
  const activeSources = getChain(chainKey).sources.filter(s => enabledSources.has(s));

  if (!amtStr || parseFloat(amtStr) <= 0) {
    box.innerHTML = '<div class="status">Enter an amount to compare quotes</div>';
    detail.innerHTML = '';
    swapBtn.disabled = true; swapBtn.textContent = 'Enter an amount';
    $('toAmount').value = '';
    return;
  }
  if (tIn.address.toLowerCase() === tOut.address.toLowerCase()) {
    box.innerHTML = '<div class="status error">Pick two different tokens</div>';
    swapBtn.disabled = true; swapBtn.textContent = 'Select tokens';
    return;
  }
  if (!activeSources.length) {
    box.innerHTML = '<div class="status error">Enable at least one quote source</div>';
    swapBtn.disabled = true;
    return;
  }

  box.innerHTML = `<div class="status"><span class="spinner"></span>Quoting via ${activeSources.map(s => SOURCE_META[s].label).join(', ')}…</div>`;
  detail.innerHTML = '';
  swapBtn.disabled = true;

  try {
    const amountInWei = ethers.parseUnits(amtStr, tIn.decimals);
    quotes = await quoteAll({ chainKey, tokenIn: tIn, tokenOut: tOut, amountInWei, wallet: getAddress(), sources: activeSources, slippageBps });
    renderQuotes(tIn, tOut, amtStr);
  } catch (e) {
    box.innerHTML = `<div class="status error">Quote failed: ${e.message.slice(0, 100)}</div>`;
  }
}

function renderQuotes(tIn, tOut, amtStr) {
  const box = $('quoteBox'), detail = $('quoteDetail'), swapBtn = $('swapBtn');
  const good = quotes.good;
  if (!good.length) {
    const reasons = quotes.all.map(r => `${SOURCE_META[r.source].label}: ${r.reason}`).join(' · ');
    box.innerHTML = `<div class="status warn">No liquidity from any enabled source.</div><div class="status" style="font-size:11px">${reasons}</div>`;
    swapBtn.disabled = true; swapBtn.textContent = 'No liquidity';
    $('toAmount').value = '';
    return;
  }
  selectedQuote = quotes.best.quote;
  $('toAmount').value = fmtAmount(selectedQuote.amountOut, tOut.decimals);

  let html = '<div class="quote-table">';
  for (const r of quotes.all) {
    const m = SOURCE_META[r.source];
    if (!r.ok) {
      html += `<div class="qr"><span class="qsrc">${m.label}<span class="tag">${r.reason}</span></span><span></span><span></span></div>`;
      continue;
    }
    const q = r.quote;
    const isBest = r === quotes.best, isSel = q === selectedQuote;
    html += `<div class="qr${isBest ? ' winner' : ''}${isSel ? ' selected' : ''}" data-src="${r.source}">
      <span class="qsrc">${m.label}<span class="tag">${m.tag}${q.raw?.kind ? ' · ' + q.raw.kind : ''}</span></span>
      <span class="qout">${fmtAmount(q.amountOut, tOut.decimals)} ${tOut.symbol}${q.amountOutUsd ? `<span class="usd">${fmtUsd(q.amountOutUsd)}</span>` : ''}</span>
      <span>${isBest ? '<span class="qbadge">BEST</span>' : ''}</span></div>`;
  }
  box.innerHTML = html + '</div>';
  box.querySelectorAll('.qr[data-src]').forEach(elm => {
    elm.onclick = () => {
      const r = quotes.all.find(x => x.source === elm.dataset.src && x.ok);
      if (r) { selectedQuote = r.quote; renderQuotes(tIn, tOut, amtStr); }
    };
  });

  const q = selectedQuote;
  const rate = parseFloat(ethers.formatUnits(q.amountOut, tOut.decimals)) / parseFloat(amtStr);
  const minOut = q.amountOut * BigInt(10000 - slippageBps) / 10000n;
  detail.innerHTML = `<div class="detail-grid">
    <span class="k">Source</span><span class="v">${SOURCE_META[q.source].label}</span>
    <span class="k">Rate</span><span class="v">1 ${tIn.symbol} ≈ ${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tOut.symbol}</span>
    <span class="k">Min received</span><span class="v">${fmtAmount(minOut, tOut.decimals)} ${tOut.symbol}</span>
    ${q.gasUsd ? `<span class="k">Est. gas</span><span class="v">${fmtUsd(q.gasUsd)}</span>` : ''}
  </div>`;

  if (!isConnected()) { swapBtn.disabled = true; swapBtn.textContent = 'Connect wallet to swap'; }
  else checkApproval();
}

async function checkApproval() {
  const approveBtn = $('approveBtn'), swapBtn = $('swapBtn');
  approveBtn.style.display = 'none';
  if (!selectedQuote || !isConnected()) return;
  const q = selectedQuote;
  if (q.tokenIn.isNative) {
    swapBtn.disabled = false;
    swapBtn.textContent = `Swap via ${SOURCE_META[q.source].label}`;
    return;
  }
  try {
    const signer = await getSigner();
    const tx = await buildTxFor(q, getAddress(), slippageBps, signer);
    q._tx = tx; // cache for the swap step
    const al = await getAllowance(q.tokenIn.address, getAddress(), tx.spender, chainKey);
    if (al < q.amountInWei) {
      approveBtn.style.display = 'block';
      approveBtn.textContent = `Approve ${q.tokenIn.symbol} for ${SOURCE_META[q.source].label}`;
      swapBtn.disabled = true;
      swapBtn.textContent = 'Approve first';
    } else {
      swapBtn.disabled = false;
      swapBtn.textContent = `Swap via ${SOURCE_META[q.source].label}`;
    }
  } catch {
    // buildTx needs a fresh quote at swap time — allow the attempt anyway
    swapBtn.disabled = false;
    swapBtn.textContent = `Swap via ${SOURCE_META[q.source].label}`;
  }
}

/* ---------------- actions ---------------- */
$('connectBtn').onclick = () => {
  if (isConnected()) appKit.open({ view: 'Account' });
  else openConnect();
};

$('flipBtn').onclick = () => {
  const f = $('fromToken'), t = $('toToken');
  const x = f.value; f.value = t.value; t.value = x;
  scheduleQuote();
};

$('maxBtn').onclick = async () => {
  const addr = getAddress();
  if (!addr) return;
  const { in: tIn } = selTokens();
  try {
    const rp = getWalletEthersProvider();
    if (tIn.isNative) {
      const bal = await rp.getBalance(addr);
      $('fromAmount').value = ethers.formatUnits(bal * 90n / 100n, 18); // keep gas
    } else {
      const c = new ethers.Contract(tIn.address, ERC20_ABI, rp);
      const bal = await c.balanceOf(addr);
      $('fromAmount').value = ethers.formatUnits(bal, tIn.decimals);
    }
    scheduleQuote();
  } catch { /* ignore */ }
};

$('fromAmount').addEventListener('input', scheduleQuote);
$('fromToken').addEventListener('change', () => { scheduleQuote(); updateBalances(); });
$('toToken').addEventListener('change', () => { scheduleQuote(); updateBalances(); });

document.querySelectorAll('[data-slip]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-slip]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $('slipCustom').value = '';
  slippageBps = Math.round(parseFloat(b.dataset.slip) * 100);
  scheduleQuote();
});
$('slipCustom').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (v > 0 && v <= 10) {
    document.querySelectorAll('[data-slip]').forEach(x => x.classList.remove('active'));
    slippageBps = Math.round(v * 100);
    scheduleQuote();
  }
});

$('approveBtn').onclick = async () => {
  if (!selectedQuote || !isConnected()) return;
  const q = selectedQuote;
  try {
    showLoading('Approving…');
    const signer = await getSigner();
    const tx = q._tx || await buildTxFor(q, getAddress(), slippageBps, signer);
    const atx = await approveToken(q.tokenIn.address, tx.spender, q.amountInWei);
    showLoading('Confirming approval…');
    await atx.wait();
    showStatus('Approved ✓', 'success');
    q._tx = null;
    checkApproval();
  } catch (e) {
    showStatus('Approval failed: ' + (e.reason || e.message || '').slice(0, 100), 'error');
  }
};

$('swapBtn').onclick = async () => {
  if (!selectedQuote || !isConnected()) return;
  const q = selectedQuote;
  try {
    // Make sure the wallet is on the right chain first
    const ck = getChainKey();
    if (ck !== chainKey) await switchNetwork(chainKey);

    showLoading('Building transaction…');
    const signer = await getSigner();
    const tx = q._tx || await buildTxFor(q, getAddress(), slippageBps, signer);

    // Simulate before asking for a signature — never send a tx we haven't dry-run
    showLoading('Simulating…');
    const sim = await simulateTx({ to: tx.to, data: tx.data, value: tx.value, from: getAddress() });
    if (!sim.ok) throw new Error('Simulation reverted — quote is stale or liquidity moved. ' + sim.reason);

    showLoading('Awaiting signature…');
    const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
    const ex = getChain(chainKey).explorer;
    showLoading(`Confirming… <a href="${ex}/tx/${sent.hash}" target="_blank">view</a>`);
    const rc = await sent.wait();
    showStatus(`Swapped ✓ <a href="${ex}/tx/${rc.hash}" target="_blank">view tx</a>`, 'success');
    q._tx = null;
    updateBalances();
    scheduleQuote();
  } catch (e) {
    showStatus('Swap failed: ' + (e.reason || e.message || '').slice(0, 140), 'error');
  }
};

/* ---------------- subscriptions ---------------- */
subscribeToAccountChanges(() => {
  updateWalletUI();
  updateBalances();
  scheduleQuote();
});
subscribeToNetworkChanges(() => {
  updateWalletUI();
});

/* ---------------- init ---------------- */
renderChains();
renderSources();
renderTokens();
updateWalletUI();
scheduleQuote();

/* ---------------- tabs: Swap | Bridge ---------------- */
$('tabSwap').onclick = () => switchTab('swap');
$('tabBridge').onclick = () => switchTab('bridge');
function switchTab(which) {
  $('tabSwap').classList.toggle('active', which === 'swap');
  $('tabBridge').classList.toggle('active', which === 'bridge');
  $('swapPane').style.display = which === 'swap' ? '' : 'none';
  $('bridgePane').style.display = which === 'bridge' ? '' : 'none';
}
