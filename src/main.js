// Bushido-dApp — main entry.
// Chains/sources are config-driven (see src/dex/chains.js). Wallet via AppKit.

import './shims/buffer-global.js';
import { ethers } from 'ethers';
import { appKit } from './config.js';
import { installPerkHeader } from './perks-client.js';
import { retryOnce } from './utils/retry.js';
import { enhanceAllSelects } from './token-picker.js';

installPerkHeader(); // sends the Dojo Pass perk token (if you unlocked one) on our own /api calls
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
let chainKey = 'monad'; // default: Monad, 1 MON -> USDC (set in init below)
// Every source starts on (users can toggle chips off). This used to be a hand-written list
// that left out aerodrome, coinbase and fusion, so those were never queried by default.
let enabledSources = new Set(Object.values(CHAINS).flatMap((c) => c.sources));
let quotes = null;
let selectedQuote = null;
let quoteRun = 0;         // id of the newest quote request (older ones are ignored)
let compareOpen = false;  // route card: is the full source list showing?
let userPick = null;      // source the user tapped; kept until the pair or chain changes
let lastPairKey = '';
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

// Server-held keys (from /api/health). null until loaded: assume set, so chips
// don't flash 🔑 on first paint.
let serverKeys = null;
let serverDisabled = new Set(); // sources switched off with DISABLED_SOURCES on the server
fetch('/api/health').then(r => r.json()).then(j => {
  serverKeys = j.keys || null;
  serverDisabled = new Set(j.disabled || []);
  renderSources();
  scheduleQuote();
}).catch(() => {});

function sourceKeySet(src) {
  if (serverKeys && src in serverKeys) return !!serverKeys[src];
  return true; // keyless source, or server status not loaded yet
}

function renderSubtitle() {
  const c = getChain(chainKey);
  $('subtitle').textContent = `Best price across ${c.sources.length} sources on ${c.label} · ${Object.keys(CHAINS).length} chains`;
}

function renderSources() {
  const row = $('srcRow');
  row.innerHTML = '';
  renderSubtitle();
  for (const src of getChain(chainKey).sources) {
    const m = SOURCE_META[src];
    const keySet = sourceKeySet(src);
    const turnedOff = serverDisabled.has(src);
    const chip = el('button',
      'src-chip' + (enabledSources.has(src) && !turnedOff ? ' active' : ' off') + (keySet ? '' : ' no-key'),
      `${m.label}${turnedOff ? ' · off' : keySet ? '' : ' 🔑'}`);
    chip.title = turnedOff ? 'Temporarily turned off' : `${m.tag}${keySet ? '' : ' — API key not set (see .env)'}`;
    chip.disabled = turnedOff;
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
  renderSafety(null);
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
  // Reads don't need the wallet. Use our public RPCs first (they work in every wallet browser); some in-app
  // wallet browsers silently fail eth_call, which used to leave "Balance: —" with no explanation.
  const providers = [];
  try { providers.push(await getReadProvider(chainKey)); } catch { /* fall back to the wallet below */ }
  try { providers.push(getWalletEthersProvider()); } catch { /* no wallet provider */ }
  for (const [tok, elId] of [[tIn, 'fromBalance'], [tOut, 'toBalance']]) {
    let label = null;
    for (const rp of providers) {
      try {
        label = await retryOnce(async () => {
          const c = new ethers.Contract(tok.address, ERC20_ABI, rp);
          const [wrapped, dec] = await Promise.all([c.balanceOf(addr), c.decimals().catch(() => tok.decimals)]);
          if (!tok.isNative) return `${fmtAmount(wrapped, Number(dec))} ${tok.symbol}`;
          const native = await rp.getBalance(addr);
          return `${fmtAmount(native, 18)} ${cfg.native} (+${fmtAmount(wrapped, Number(dec))} wrapped)`;
        });
        break;
      } catch { /* try the next provider */ }
    }
    $(elId).textContent = 'Balance: ' + (label ?? '—');
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
  const activeSources = getChain(chainKey).sources.filter(s => enabledSources.has(s) && !serverDisabled.has(s));
  const pairKey = `${chainKey}:${tIn.address}:${tOut.address}`;
  if (pairKey !== lastPairKey) { userPick = null; lastPairKey = pairKey; }

  if (!amtStr || parseFloat(amtStr) <= 0) {
    box.innerHTML = '<div class="status">Enter an amount to compare quotes</div>';
    detail.innerHTML = '';
    swapBtn.disabled = true; swapBtn.textContent = 'Enter an amount';
    $('toAmount').value = '';
    return;
  }
  if (tIn.address.toLowerCase() === tOut.address.toLowerCase()) {
    const wrapPair = tIn.isNative !== tOut.isNative;
    box.innerHTML = wrapPair
      ? `<div class="status error">${tIn.symbol} and ${tOut.symbol} are the same value (wrapped and unwrapped). Wrapping isn't built into the swap yet, so pick a different token.</div>`
      : '<div class="status error">Pick two different tokens</div>';
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

  // Newest run wins: a slow older run must not overwrite a newer one.
  const run = ++quoteRun;
  try {
    const amountInWei = ethers.parseUnits(amtStr, tIn.decimals);
    const result = await quoteAll({
      chainKey, tokenIn: tIn, tokenOut: tOut, amountInWei, wallet: getAddress(), sources: activeSources, slippageBps,
      disabled: serverDisabled,
      // Show quotes as they arrive instead of waiting for the slowest source.
      onResult: (_r, snap) => {
        if (run !== quoteRun || !snap.good.length || !snap.pending) return;
        quotes = snap;
        renderQuotes(tIn, tOut, amtStr, true);
      },
    });
    if (run !== quoteRun) return;
    quotes = result;
    renderQuotes(tIn, tOut, amtStr);
  } catch (e) {
    if (run === quoteRun) box.innerHTML = `<div class="status error">Quote failed: ${e.message.slice(0, 100)}</div>`;
  }
}

function renderQuotes(tIn, tOut, amtStr, partial = false) {
  const box = $('quoteBox'), detail = $('quoteDetail'), swapBtn = $('swapBtn');
  const good = quotes.good;
  // Sources that can't serve this pair (or are switched off) were never asked: leave them out.
  const shown = quotes.all.filter(r => !r.skipped);
  if (!good.length && !navigator.onLine) {
    box.innerHTML = '<div class="status warn">You\'re offline. Quotes need a connection; they\'ll refresh when you\'re back online.</div>';
    swapBtn.disabled = true; swapBtn.textContent = 'Offline'; renderSafety(null);
    $('toAmount').value = '';
    return;
  }
  if (!good.length) {
    const reasons = shown.map(r => `${SOURCE_META[r.source].label}: ${r.reason}`).join(' · ');
    box.innerHTML = `<div class="status warn">No liquidity from any enabled source.</div><div class="status" style="font-size:11px">${reasons}</div>`;
    swapBtn.disabled = true; swapBtn.textContent = 'No liquidity'; renderSafety(null);
    $('toAmount').value = '';
    return;
  }
  // The user's tapped source wins if it still has a quote; otherwise the best one.
  selectedQuote = good.find(r => r.source === userPick)?.quote ?? quotes.best.quote;
  $('toAmount').value = fmtAmount(selectedQuote.amountOut, tOut.decimals);

  // Route card: the chosen source on top, "compare" opens every source's quote.
  const sel = good.find(r => r.quote === selectedQuote);
  const rest = good.filter(r => r !== sel).sort((x, y) => (x.quote.amountOut < y.quote.amountOut ? 1 : -1));
  const next = rest[0]?.quote.amountOut;
  const gain = next && next > 0n ? Number((selectedQuote.amountOut - next) * 10000n / next) / 100 : null;
  const isBestSel = sel === quotes.best;
  const mSel = SOURCE_META[selectedQuote.source];
  let list = '<div class="quote-table">';
  for (const r of shown) {
    const m = SOURCE_META[r.source];
    if (!r.ok) {
      list += `<div class="qr"><span class="qsrc">${m.label}<span class="tag">${r.reason}</span></span><span></span><span></span></div>`;
      continue;
    }
    const q = r.quote;
    const isBest = r === quotes.best, isSel = q === selectedQuote;
    list += `<div class="qr${isBest ? ' winner' : ''}${isSel ? ' selected' : ''}" data-src="${r.source}">
      <span class="qsrc">${m.label}<span class="tag">${m.tag}${q.raw?.kind ? ' · ' + q.raw.kind : ''}</span></span>
      <span class="qout">${fmtAmount(q.amountOut, tOut.decimals)} ${tOut.symbol}${q.amountOutUsd ? `<span class="usd">${fmtUsd(q.amountOutUsd)}</span>` : ''}</span>
      <span>${isBest ? '<span class="qbadge">BEST</span>' : ''}</span></div>`;
  }
  list += '</div>';
  box.innerHTML = `<div class="route-top"><span class="route-name">${mSel.label}${isBestSel ? ' <span class="qbadge">BEST</span>' : ''}</span>
      ${gain !== null && gain > 0 ? `<span class="route-gain">+${gain.toFixed(2)}% vs next</span>` : ''}</div>
    <div class="route-sub">${partial && quotes.pending ? `<span class="spinner"></span>${good.length} quoted · ${quotes.pending} still checking…` : `${good.length} of ${shown.length} sources quoted`}<button type="button" id="cmpBtn" aria-expanded="${compareOpen}">${compareOpen ? 'hide ⌃' : 'compare ⌄'}</button></div>
    <div class="route-list">${list}</div>`;
  $('routeCard').classList.toggle('open', compareOpen);
  $('routeCard').classList.toggle('best-card', isBestSel);
  $('cmpBtn').onclick = () => {
    compareOpen = !compareOpen;
    $('routeCard').classList.toggle('open', compareOpen);
    $('cmpBtn').textContent = compareOpen ? 'hide ⌃' : 'compare ⌄';
    $('cmpBtn').setAttribute('aria-expanded', compareOpen);
  };
  box.querySelectorAll('.qr[data-src]').forEach(elm => {
    elm.onclick = () => {
      const r = quotes.all.find(x => x.source === elm.dataset.src && x.ok);
      if (r) { userPick = r.source; renderQuotes(tIn, tOut, amtStr); }
    };
  });

  const q = selectedQuote;
  const rate = parseFloat(ethers.formatUnits(q.amountOut, tOut.decimals)) / parseFloat(amtStr);
  // Fusion quotes carry their own guaranteed minimum (the auction's end amount).
  const minOut = q.minAmountOut ?? (q.amountOut * BigInt(10000 - slippageBps) / 10000n);
  detail.innerHTML = `<div class="detail-grid">
    <span class="k">Rate</span><span class="v">1 ${tIn.symbol} ≈ ${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tOut.symbol}</span>
    <span class="k">Min received</span><span class="v">${fmtAmount(minOut, tOut.decimals)} ${tOut.symbol}</span>
    <span class="k">Est. gas</span><span class="v">${q.gasless ? 'None (resolvers pay)' : q.gasUsd > 0 ? (q.gasUsd < 0.01 ? '< $0.01' : fmtUsd(q.gasUsd)) : '—'}</span>
  </div>`;

  renderSafety(q);
  if (partial) { swapBtn.disabled = true; swapBtn.textContent = 'Checking more sources…'; return; }
  if (!isConnected()) { swapBtn.disabled = false; swapBtn.textContent = 'Connect wallet'; }
  else checkApproval();
}

// Button text for the selected quote. Fusion is signed, not sent.
const swapLabel = (q) => q.gasless
  ? `Sign gasless swap via ${SOURCE_META[q.source].label}`
  : `Swap ${fmtAmount(q.amountInWei, q.tokenIn.decimals)} ${q.tokenIn.symbol} → ${q.tokenOut.symbol}`;

// Safety checks above the button. The simulation is a real dry-run that happens
// when you tap Swap (before any signature); until then it is shown as pending, not passed.
function renderSafety(q, sim = 'pending', simNote = '') {
  const box = $('safetyBox');
  if (!q) { box.innerHTML = ''; return; }
  const pct = (slippageBps / 100).toFixed(slippageBps % 10 ? 2 : 1).replace(/\.0$/, '');
  const rows = [
    ['ok', '✓', `Slippage ${pct}% (limit 0.1–1%)`],
    q.gasless
      ? ['ok', '✓', 'Gasless order: you sign it, nothing is sent from your wallet']
      : sim === 'ok' ? ['ok', '✓', 'Simulation passed: this trade will not revert']
      : sim === 'run' ? ['run', '…', 'Simulating the trade…']
      : sim === 'bad' ? ['bad', '✕', `Simulation failed: ${simNote}`]
      : ['', '○', 'Simulation runs automatically before you sign'],
    ['ok', '✓', `Minimum you receive is guaranteed: ${fmtAmount(q.minAmountOut ?? (q.amountOut * BigInt(10000 - slippageBps) / 10000n), q.tokenOut.decimals)} ${q.tokenOut.symbol}`],
  ];
  box.innerHTML = rows.map(([c, m, t]) => `<div class="chk ${c}"><span class="mk">${m}</span><span>${t}</span></div>`).join('');
}

async function checkApproval() {
  const approveBtn = $('approveBtn'), swapBtn = $('swapBtn');
  approveBtn.style.display = 'none';
  if (!selectedQuote || !isConnected()) return;
  const q = selectedQuote;
  if (q.gasless) {
    // Fusion: the user approves 1inch's order contract once, then signs an order (no transaction).
    try {
      const al = await getAllowance(q.tokenIn.address, getAddress(), q.raw.spender, chainKey);
      if (al < q.amountInWei) {
        approveBtn.style.display = 'block';
        approveBtn.textContent = `Approve ${q.tokenIn.symbol} for ${SOURCE_META[q.source].label}`;
        swapBtn.disabled = true;
        swapBtn.textContent = 'Approve first';
        return;
      }
    } catch { /* allowance unreadable: let the order check fail loudly instead */ }
    swapBtn.disabled = false;
    swapBtn.textContent = swapLabel(q);
    return;
  }
  if (q.tokenIn.isNative) {
    swapBtn.disabled = false;
    swapBtn.textContent = swapLabel(q);
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
      swapBtn.textContent = swapLabel(q);
    }
  } catch {
    // buildTx needs a fresh quote at swap time — allow the attempt anyway
    swapBtn.disabled = false;
    swapBtn.textContent = swapLabel(q);
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
  slippageBps = Math.round(parseFloat(b.dataset.slip) * 100);
  scheduleQuote();
  if (selectedQuote) renderSafety(selectedQuote);
});
$('approveBtn').onclick = async () => {
  if (!selectedQuote || !isConnected()) return;
  const q = selectedQuote;
  try {
    showLoading('Approving…');
    const signer = await getSigner();
    const tx = q.gasless ? { spender: q.raw.spender } : (q._tx || await buildTxFor(q, getAddress(), slippageBps, signer));
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
  if (!isConnected()) { openConnect(); return; }
  if (!selectedQuote || !isConnected()) return;
  const q = selectedQuote;
  try {
    // Make sure the wallet is on the right chain first
    const ck = getChainKey();
    if (ck !== chainKey) await switchNetwork(chainKey);

    if (q.gasless) {
      // 1inch Fusion: sign an order (no gas, no transaction), then wait for a resolver to fill it.
      const { runFusionSwap } = await import('./dex/fusion-wallet.js');
      const r = await runFusionSwap({
        chainKey, chainId: getChain(chainKey).chainId, q, wallet: getAddress(), slippageBps,
        onStage: (stage, status, sec) => {
          if (stage === 'sign') showLoading('Sign the order in your wallet (no gas needed)…');
          else showLoading(`Order submitted. Waiting for a resolver to fill it… ${status === 'partially-filled' ? '(partly filled) ' : ''}${sec}s`);
        },
      });
      const ex = getChain(chainKey).explorer;
      showStatus(`Swapped ✓ gasless via 1inch Fusion${r.txHash ? ` <a href="${ex}/tx/${r.txHash}" target="_blank">view tx</a>` : ''}`, 'success');
      updateBalances();
      scheduleQuote();
      return;
    }

    showLoading('Building transaction…');
    const signer = await getSigner();
    const tx = q._tx || await buildTxFor(q, getAddress(), slippageBps, signer);

    // Simulate before asking for a signature — never send a tx we haven't dry-run
    showLoading('Simulating…');
    renderSafety(q, 'run');
    const sim = await simulateTx({ to: tx.to, data: tx.data, value: tx.value, from: getAddress() });
    if (!sim.ok) { renderSafety(q, 'bad', sim.reason); throw new Error('Simulation reverted — quote is stale or liquidity moved. ' + sim.reason); }
    renderSafety(q, 'ok');

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

// Re-quote as soon as the connection comes back (installed app opened offline).
window.addEventListener('online', () => scheduleQuote());

/* ---------------- init ---------------- */
renderChains();
renderSources();
renderTokens();
$('fromAmount').value = '1'; // default pair on Monad is MON -> USDC
updateWalletUI();
scheduleQuote();

/* ---------------- tabs: Swap | Bridge ---------------- */
const TABS = { swap: ['tabSwap', 'swapPane'], bridge: ['tabBridge', 'bridgePane'], intel: ['tabIntel', 'intelPane'], bushido: ['tabBushido', 'bushidoPane'], merkl: ['tabMerkl', 'merklPane'] };
for (const [name, [tab]] of Object.entries(TABS)) $(tab).onclick = () => switchTab(name);
async function switchTab(which) {
  for (const [name, [tab, pane]] of Object.entries(TABS)) {
    $(tab).classList.toggle('active', name === which);
    $(pane).style.display = name === which ? '' : 'none';
  }
  // React + the dashboard load only when the Bushido tab is first opened.
  if (which === 'bushido') (await import('./bushido-mount.jsx')).showBushido();
  // Merkl module loads only when the Rewards tab is first opened.
  if (which === 'merkl') (await import('./merkl.js')).showMerkl();
}

// Our own coin/chain list instead of native dropdowns (those never open in some wallet in-app browsers).
enhanceAllSelects();
