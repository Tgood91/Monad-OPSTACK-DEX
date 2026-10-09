// Bridge pane — NEAR Intents cross-chain via the keyless 1Click API.
// Flow: quote (dry) → intent (wet, deposit address) → user deposits from wallet
// → deposit-submit → status poll until terminal.
// Shares the page's wallet bar with the swap pane (main.js owns it).

import { ethers } from 'ethers';
import { appKit } from './config.js';
import {
  isConnected, getAddress, getSigner, subscribeToAccountChanges,
} from './utils/web3.js';
import { ERC20_ABI } from './utils/abis.js';

/* ---------------- config ---------------- */
const BRIDGE_CHAINS = {
  base:     { chainId: 8453, label: 'Base',     native: 'ETH', explorer: 'https://basescan.org',            rpcs: ['https://mainnet.base.org', 'https://1rpc.io/base'] },
  optimism: { chainId: 10,   label: 'Optimism', native: 'ETH', explorer: 'https://optimistic.etherscan.io', rpcs: ['https://mainnet.optimism.io', 'https://1rpc.io/op'] },
  ethereum: { chainId: 1,    label: 'Ethereum', native: 'ETH', explorer: 'https://etherscan.io',            rpcs: ['https://1rpc.io/eth', 'https://eth.drpc.org'] },
  monad:    { chainId: 143,  label: 'Monad',    native: 'MON', explorer: 'https://monadvision.com',         rpcs: ['https://rpc.monad.xyz', 'https://monad-mainnet.drpc.org'] },
  arbitrum: { chainId: 42161, label: 'Arbitrum', native: 'ETH', explorer: 'https://arbiscan.io',             rpcs: ['https://arb1.arbitrum.io/rpc'] },
  avalanche:{ chainId: 43114, label: 'Avalanche',native: 'AVAX',explorer: 'https://snowtrace.io',            rpcs: ['https://api.avax.network/ext/bc/C/rpc'] },
  bsc:      { chainId: 56,    label: 'BNB Chain',native: 'BNB', explorer: 'https://bscscan.com',              rpcs: ['https://bsc-dataseed.binance.org'] },
};

// Chains each bridge source supports
const SOURCE_CHAINS = {
  near: ['base', 'optimism', 'ethereum', 'monad'],
  stargate: ['ethereum', 'base', 'optimism', 'arbitrum', 'avalanche', 'bsc'],
  aori: ['ethereum', 'base', 'optimism', 'arbitrum', 'monad', 'bsc'],
};

const $ = id => document.getElementById('b' + id[0].toUpperCase() + id.slice(1));
const state = {
  source: 'near',
  fromChain: 'base', toChain: 'monad',
  fromTokens: [], toTokens: [],
  quote: null, intent: null,
  quoteTimer: null, statusTimer: null,
};

/* ---------------- api ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `API ${res.status}`);
  return j;
}

async function loadTokens(chainKey) {
  const chainId = BRIDGE_CHAINS[chainKey].chainId;
  if (state.source === 'aori') {
    const { tokens } = await api(`/api/aori/tokens?chainKey=${chainKey}`);
    return tokens;
  }
  if (state.source === 'stargate') {
    const { tokens } = await api(`/api/stargate/tokens?chainId=${chainId}`);
    // Normalize to { symbol, ref, address, decimals } — Stargate is same-asset only.
    return tokens.map(t => ({
      symbol: t.symbol,
      ref: t.ref,
      address: t.ref === 'NATIVE' ? null : 'pool', // resolved server-side; 'pool' marks ERC-20
      decimals: t.ref === 'NATIVE' ? 18 : 6,
      stargate: true,
    }));
  }
  const { tokens } = await api(`/api/near/tokens?chainId=${chainId}`);
  return tokens;
}

function fillTokenSelect(selEl, tokens) {
  selEl.innerHTML = '';
  tokens.forEach((t, i) => selEl.add(new Option(t.symbol, i)));
}

/* ---------------- wallet helpers ---------------- */
function walletProvider() {
  const wp = appKit.getWalletProvider();
  if (!wp) throw new Error('Wallet not connected');
  return wp;
}

async function ensureOnChain(chainKey) {
  const cfg = BRIDGE_CHAINS[chainKey];
  const wp = walletProvider();
  const hexId = '0x' + cfg.chainId.toString(16);
  try {
    await wp.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (e) {
    if (e?.code === 4902 || /unknown|unrecognized/i.test(e?.message || '')) {
      await wp.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexId, chainName: cfg.label,
          nativeCurrency: { name: cfg.native, symbol: cfg.native, decimals: 18 },
          rpcUrls: cfg.rpcs, blockExplorerUrls: [cfg.explorer],
        }],
      });
    } else throw e;
  }
}

function setStatus(msg, kind = '') {
  $('txStatus').innerHTML = msg ? `<div class="status ${kind}">${msg}</div>` : '';
}

/* ---------------- rendering ---------------- */
function renderChains() {
  const keys = SOURCE_CHAINS[state.source];
  for (const id of ['fromChain', 'toChain']) {
    const s = $(id);
    s.innerHTML = '';
    for (const key of keys) s.add(new Option(BRIDGE_CHAINS[key].label, key));
  }
  if (!keys.includes(state.fromChain)) state.fromChain = keys[0];
  if (!keys.includes(state.toChain)) state.toChain = keys[1] || keys[0];
  $('fromChain').value = state.fromChain;
  $('toChain').value = state.toChain;
}

async function refreshTokens(side) {
  const chainKey = side === 'from' ? state.fromChain : state.toChain;
  const toks = await loadTokens(chainKey);
  const sel = $(side === 'from' ? 'fromToken' : 'toToken');
  if (side === 'from') { state.fromTokens = toks; fillTokenSelect(sel, toks); }
  else { state.toTokens = toks; fillTokenSelect(sel, toks); }
  // Sensible defaults: from = USDC if listed, to = native token if listed.
  // Stargate is same-asset only, so mirror the from-token on the to side.
  let defIdx;
  if (state.source === 'stargate' && side === 'to') {
    const fromSym = (state.fromTokens[Number($('fromToken').value)] || {}).symbol;
    defIdx = Math.max(0, toks.findIndex(t => t.symbol === fromSym));
  } else {
    defIdx = side === 'from'
      ? Math.max(0, toks.findIndex(t => t.symbol === 'USDC'))
      : Math.max(0, toks.findIndex(t => !t.address));
  }
  sel.selectedIndex = defIdx;
  if (side === 'from') updateBalance();
  scheduleQuote();
}

function selTokens() {
  const fi = state.fromTokens[Number($('fromToken').value)] || null;
  const ti = state.toTokens[Number($('toToken').value)] || null;
  return { fi, ti };
}

function tokenRef(t) { return t.address || 'native'; }

async function updateBalance() {
  const addr = getAddress();
  if (!addr) { $('fromBalance').textContent = 'Balance: —'; return; }
  const { fi } = selTokens();
  if (!fi) return;
  const cfg = BRIDGE_CHAINS[state.fromChain];
  try {
    const p = new ethers.JsonRpcProvider(cfg.rpcs[0]);
    let label;
    if (!fi.address) {
      label = `${Number(ethers.formatUnits(await p.getBalance(addr), 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${fi.symbol}`;
    } else {
      const c = new ethers.Contract(fi.address, ERC20_ABI, p);
      const bal = await c.balanceOf(addr);
      label = `${Number(ethers.formatUnits(bal, fi.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${fi.symbol}`;
    }
    $('fromBalance').textContent = 'Balance: ' + label;
  } catch { $('fromBalance').textContent = 'Balance: —'; }
}

/* ---------------- quoting ---------------- */
function scheduleQuote() {
  clearTimeout(state.quoteTimer);
  state.quoteTimer = setTimeout(refreshQuote, 700);
}

async function refreshQuote() {
  const btn = $('bridgeBtn'), box = $('quoteBox'), detail = $('quoteDetail');
  if (!btn) return; // bridge pane not in DOM
  state.quote = null; state.intent = null;
  $('depositCard').style.display = 'none';
  $('statusCard').style.display = 'none';
  clearInterval(state.statusTimer);

  const wallet = getAddress();

  const amtStr = $('fromAmount').value;
  const { fi, ti } = selTokens();
  if (!fi || !ti) return;
  if (state.fromChain === state.toChain) {
    box.innerHTML = '<div class="status error">Pick two different chains</div>';
    btn.disabled = true; btn.textContent = 'Select chains';
    return;
  }
  if (!amtStr || parseFloat(amtStr) <= 0) {
    box.innerHTML = '<div class="status">Enter an amount to get a bridge quote</div>';
    detail.innerHTML = '';
    btn.disabled = true; btn.textContent = 'Enter an amount';
    $('toAmount').value = '';
    return;
  }
  if (!wallet) {
    // 1Click needs a real recipient address — no anonymous quotes.
    box.innerHTML = '<div class="status">Connect your wallet to get a bridge quote</div>';
    detail.innerHTML = '';
    btn.disabled = true; btn.textContent = 'Connect wallet to bridge';
    $('toAmount').value = '';
    return;
  }

  const sourceLabel = state.source === 'stargate' ? 'Stargate' : state.source === 'aori' ? 'Aori' : 'NEAR Intents';
  box.innerHTML = `<div class="status"><span class="spinner"></span>Quoting via ${sourceLabel}…</div>`;
  detail.innerHTML = '';
  btn.disabled = true;

  try {
    if (state.source === 'aori') {
      await refreshAoriQuote({ btn, box, detail, wallet, amtStr, fi, ti });
      return;
    }
    if (state.source === 'stargate') {
      await refreshStargateQuote({ btn, box, detail, wallet, amtStr, fi, ti });
      return;
    }
    const amountAtomic = ethers.parseUnits(amtStr, fi.decimals).toString();
    const { quote } = await api('/api/near/quote', {
      method: 'POST',
      body: JSON.stringify({
        fromChainId: BRIDGE_CHAINS[state.fromChain].chainId,
        toChainId: BRIDGE_CHAINS[state.toChain].chainId,
        fromToken: tokenRef(fi), toToken: tokenRef(ti),
        amountAtomic, wallet,
        slippageBps: 100,
      }),
    });
    state.quote = { ...quote, fi, ti, amountAtomic };
    $('toAmount').value = Number(quote.amountOutFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 });
    const rate = Number(quote.amountOutFormatted) / Number(quote.amountInFormatted);
    box.innerHTML = `<div class="status success">1 ${fi.symbol} → ${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${ti.symbol}</div>`;
    detail.innerHTML = `<div class="detail-grid">
      <span class="k">You receive</span><span class="v">${Number(quote.amountOutFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${ti.symbol}${quote.amountOutUsd ? ` (~$${Number(quote.amountOutUsd).toFixed(2)})` : ''}</span>
      <span class="k">Min received</span><span class="v">${Number(ethers.formatUnits(BigInt(quote.minAmountOut), ti.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${ti.symbol}</span>
      <span class="k">Est. time</span><span class="v">~${quote.timeEstimateSec || '?'}s</span>
      <span class="k">Source</span><span class="v">NEAR Intents</span>
    </div>`;
    btn.disabled = !wallet;
    btn.textContent = wallet ? 'Bridge via NEAR Intents' : 'Connect wallet to bridge';
  } catch (e) {
    box.innerHTML = `<div class="status error">Quote failed: ${e.message.slice(0, 120)}</div>`;
    btn.disabled = true; btn.textContent = 'No quote';
  }
}

/* ---------------- Stargate quoting ---------------- */
async function refreshStargateQuote({ btn, box, detail, wallet, amtStr, fi, ti }) {
  // Same-asset only: USDC -> USDC, etc.
  if (fi.symbol !== ti.symbol) {
    box.innerHTML = '<div class="status error">Stargate bridges the same asset only — match the tokens</div>';
    btn.disabled = true; btn.textContent = 'Match tokens';
    return;
  }
  const amountAtomic = ethers.parseUnits(amtStr, fi.decimals).toString();
  const { quote } = await api('/api/stargate/quote', {
    method: 'POST',
    body: JSON.stringify({
      fromChainId: BRIDGE_CHAINS[state.fromChain].chainId,
      toChainId: BRIDGE_CHAINS[state.toChain].chainId,
      tokenRef: fi.ref, amountAtomic, recipient: wallet,
    }),
  });
  state.quote = { ...quote, fi, ti, amountAtomic, stargate: true };
  const out = Number(ethers.formatUnits(BigInt(quote.amountReceived), fi.decimals));
  const inp = Number(amtStr);
  $('toAmount').value = out.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const feeEth = Number(ethers.formatEther(BigInt(quote.nativeFee)));
  box.innerHTML = `<div class="status success">1 ${fi.symbol} → ${(out / inp).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${ti.symbol}</div>`;
  detail.innerHTML = `<div class="detail-grid">
    <span class="k">You receive</span><span class="v">${out.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${ti.symbol} on ${BRIDGE_CHAINS[state.toChain].label}</span>
    <span class="k">Bridge fee</span><span class="v">~${feeEth.toFixed(6)} ${BRIDGE_CHAINS[state.fromChain].native} (LayerZero message)</span>
    <span class="k">Source</span><span class="v">Stargate</span>
  </div>`;
  btn.disabled = !wallet;
  btn.textContent = wallet ? 'Bridge via Stargate' : 'Connect wallet to bridge';
}

/* ---------------- Aori quoting ---------------- */
async function refreshAoriQuote({ btn, box, detail, wallet, amtStr, fi, ti }) {
  const amountAtomic = ethers.parseUnits(amtStr, fi.decimals).toString();
  const { order, fi: ofi, ti: oti } = await api('/api/aori/quote', {
    method: 'POST',
    body: JSON.stringify({
      fromChainKey: state.fromChain,
      toChainKey: state.toChain,
      fromToken: ofi.address || 'native',
      toToken: oti.address || 'native',
      amountAtomic, wallet,
    }),
  });
  state.quote = { order, fi: ofi, ti: oti, amountAtomic, aori: true };
  const out = Number(ethers.formatUnits(BigInt(order.outputAmount), oti.decimals));
  const inp = Number(amtStr);
  $('toAmount').value = out.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const estSec = Math.round(Number(order.estimatedTime || 4000) / 1000);
  box.innerHTML = `<div class="status success">1 ${ofi.symbol} → ${(out / inp).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${oti.symbol}</div>`;
  detail.innerHTML = `<div class="detail-grid">
    <span class="k">You receive</span><span class="v">${out.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${oti.symbol} on ${BRIDGE_CHAINS[state.toChain].label}</span>
    <span class="k">Est. time</span><span class="v">~${estSec}s (intent fill)</span>
    <span class="k">Source</span><span class="v">Aori</span>
  </div>`;
  btn.disabled = !wallet;
  btn.textContent = wallet ? 'Bridge via Aori' : 'Connect wallet to bridge';
}

/* ---------------- bridge flow ---------------- */
function renderSteps(activeIdx, failed = false) {
  const labels = ['Deposit', 'Processing', 'Done'];
  $('stepsBar').innerHTML = labels.map((l, i) => {
    const cls = failed && i === activeIdx ? 'failed' : i < activeIdx ? 'done' : i === activeIdx ? 'active' : '';
    return `<div class="step ${cls}">${l}</div>`;
  }).join('');
}

async function startBridge() {
  const wallet = getAddress();
  if (!state.quote || !wallet) return;
  if (state.quote.aori) return startAoriBridge(wallet);
  if (state.quote.stargate) return startStargateBridge(wallet);
  const q = state.quote;
  const btn = $('bridgeBtn');
  try {
    btn.disabled = true;
    setStatus('<span class="spinner"></span>Creating bridge intent…');
    const { quote } = await api('/api/near/intent', {
      method: 'POST',
      body: JSON.stringify({
        fromChainId: BRIDGE_CHAINS[state.fromChain].chainId,
        toChainId: BRIDGE_CHAINS[state.toChain].chainId,
        fromToken: tokenRef(q.fi), toToken: tokenRef(q.ti),
        amountAtomic: q.amountAtomic, wallet, slippageBps: 100,
      }),
    });
    if (!quote.depositAddress) throw new Error('no deposit address returned');
    state.intent = { ...quote, fi: q.fi, ti: q.ti, amountAtomic: q.amountAtomic };

    const cfg = BRIDGE_CHAINS[state.fromChain];
    const amtFmt = Number(quote.amountInFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 });
    $('depositCard').style.display = 'block';
    $('depositBox').innerHTML = `<div class="deposit-box">
      Send <b>exactly ${amtFmt} ${q.fi.symbol}</b> on <b>${cfg.label}</b> to:
      <div class="addr">${quote.depositAddress}</div>
      <div style="color:var(--muted);font-size:12px;margin-bottom:8px;">Address expires in ~10 min. Refunds go back to your wallet on failure.</div>
      <button class="btn btn-secondary" id="bCopyAddrBtn">Copy address</button>
      <button class="btn btn-bridge" id="bSendDepositBtn">Send deposit from wallet</button>
    </div>`;
    document.getElementById('bCopyAddrBtn').onclick = () => { navigator.clipboard.writeText(quote.depositAddress); setStatus('Address copied', 'success'); };
    document.getElementById('bSendDepositBtn').onclick = sendDeposit;
    setStatus('');
    btn.textContent = 'Intent created — send deposit above';
  } catch (e) {
    setStatus('Intent failed: ' + e.message.slice(0, 140), 'error');
    btn.disabled = false;
    btn.textContent = 'Bridge via NEAR Intents';
  }
}

async function sendDeposit() {
  const it = state.intent;
  if (!it) return;
  const btn = document.getElementById('bSendDepositBtn');
  try {
    btn.disabled = true;
    setStatus('<span class="spinner"></span>Switching wallet to ' + BRIDGE_CHAINS[state.fromChain].label + '…');
    await ensureOnChain(state.fromChain);
    const signer = await getSigner();
    const amount = BigInt(it.amountAtomic);

    let sent;
    if (!it.fi.address) {
      setStatus('<span class="spinner"></span>Awaiting signature — native deposit…');
      sent = await signer.sendTransaction({ to: it.depositAddress, value: amount });
    } else {
      setStatus('<span class="spinner"></span>Awaiting signature — token deposit…');
      const c = new ethers.Contract(it.fi.address, ERC20_ABI, signer);
      sent = await c.transfer(it.depositAddress, amount);
    }
    const ex = BRIDGE_CHAINS[state.fromChain].explorer;
    setStatus(`<span class="spinner"></span>Deposit sent — <a href="${ex}/tx/${sent.hash}" target="_blank">view</a> · confirming…`);

    // Notify 1Click to speed up detection (best-effort), then poll status.
    try {
      await api('/api/near/deposit-submit', {
        method: 'POST',
        body: JSON.stringify({ depositAddress: it.depositAddress, txHash: sent.hash }),
      });
    } catch { /* optional */ }

    $('statusCard').style.display = 'block';
    renderSteps(0);
    $('statusBox').innerHTML = '<div class="status"><span class="spinner"></span>Waiting for deposit confirmation…</div>';
    setStatus('');
    pollStatus();
  } catch (e) {
    setStatus('Deposit failed: ' + (e.reason || e.message || '').slice(0, 140), 'error');
    btn.disabled = false;
  }
}

async function pollStatus() {
  clearInterval(state.statusTimer);
  const tick = async () => {
    try {
      const s = await api(`/api/near/status?depositAddress=${state.intent.depositAddress}`);
      const st = s.status;
      if (st === 'SUCCESS') {
        renderSteps(3);
        $('statusBox').innerHTML = `<div class="status success">Bridged ✓ ${Number(state.intent.amountOutFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${state.intent.ti.symbol} on ${BRIDGE_CHAINS[state.toChain].label}</div>`;
        setStatus('Done ✓', 'success');
        clearInterval(state.statusTimer);
      } else if (['FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT'].includes(st)) {
        renderSteps(st === 'FAILED' ? 1 : 0, true);
        $('statusBox').innerHTML = `<div class="status ${st === 'REFUNDED' ? 'warn' : 'error'}">${st === 'REFUNDED' ? 'Refunded — funds returned to your wallet' : st === 'INCOMPLETE_DEPOSIT' ? 'Incomplete deposit — partial amount sent' : 'Bridge failed'}</div>`;
        clearInterval(state.statusTimer);
      } else {
        const idx = st === 'PENDING_DEPOSIT' || st === 'KNOWN_DEPOSIT_TX' ? 0 : 1;
        renderSteps(idx);
        $('statusBox').innerHTML = `<div class="status"><span class="spinner"></span>${String(st).replace(/_/g, ' ').toLowerCase()}…</div>`;
      }
    } catch (e) {
      $('statusBox').innerHTML = `<div class="status warn">Status check failed: ${e.message.slice(0, 80)} — retrying…</div>`;
    }
  };
  await tick();
  state.statusTimer = setInterval(tick, 10000);
}

/* ---------------- Stargate bridge flow ---------------- */
async function startStargateBridge(wallet) {
  const q = state.quote;
  const btn = $('bridgeBtn');
  try {
    btn.disabled = true;
    setStatus('<span class="spinner"></span>Switching wallet to ' + BRIDGE_CHAINS[state.fromChain].label + '…');
    await ensureOnChain(state.fromChain);
    const signer = await getSigner();
    const amount = BigInt(q.amountAtomic);

    // ERC-20: approve the pool first (skip if allowance already covers it).
    if (!q.isNative && q.token && q.token !== ethers.ZeroAddress) {
      const token = new ethers.Contract(q.token, ERC20_ABI, signer);
      const allowance = await token.allowance(wallet, q.pool);
      if (allowance < amount) {
        setStatus('<span class="spinner"></span>Awaiting signature — approve ' + q.fi.symbol + '…');
        const tx = await token.approve(q.pool, amount);
        setStatus('<span class="spinner"></span>Approval confirming…');
        await tx.wait();
      }
    }

    setStatus('<span class="spinner"></span>Building Stargate transaction…');
    const { tx } = await api('/api/stargate/build-tx', {
      method: 'POST',
      body: JSON.stringify({ quote: q, refundAddress: wallet }),
    });

    setStatus('<span class="spinner"></span>Awaiting signature — bridge via Stargate…');
    const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) });
    const ex = BRIDGE_CHAINS[state.fromChain].explorer;
    $('statusCard').style.display = 'block';
    $('depositCard').style.display = 'none';
    renderSteps(1);
    $('statusBox').innerHTML = `<div class="status success">Bridge sent — <a href="${ex}/tx/${sent.hash}" target="_blank">view</a><br/>Tokens arrive on ${BRIDGE_CHAINS[state.toChain].label} in a few minutes via LayerZero.</div>`;
    setStatus('Done ✓', 'success');
    btn.textContent = 'Bridge via Stargate';
    btn.disabled = false;
  } catch (e) {
    setStatus('Bridge failed: ' + (e.reason || e.message || '').slice(0, 140), 'error');
    btn.disabled = false;
    btn.textContent = 'Bridge via Stargate';
  }
}

/* ---------------- Aori bridge flow ---------------- */
// User signs the EIP-712 order; a maker fills it and delivers to the recipient.
async function startAoriBridge(wallet) {
  const q = state.quote;
  const btn = $('bridgeBtn');
  try {
    btn.disabled = true;
    setStatus('<span class="spinner"></span>Preparing Aori order…');
    const { domain, types, message } = await api('/api/aori/sign-data', {
      method: 'POST',
      body: JSON.stringify({ order: q.order, fromChainKey: state.fromChain }),
    });

    setStatus('<span class="spinner"></span>Awaiting signature — sign the bridge order…');
    const signer = await getSigner();
    const signature = await signer.signTypedData(domain, types, message);

    setStatus('<span class="spinner"></span>Submitting order to Aori…');
    await api('/api/aori/swap', {
      method: 'POST',
      body: JSON.stringify({ orderHash: q.order.orderHash, signature }),
    });

    $('statusCard').style.display = 'block';
    $('depositCard').style.display = 'none';
    renderSteps(1);
    $('statusBox').innerHTML = '<div class="status"><span class="spinner"></span>Order submitted — waiting for maker fill…</div>';
    setStatus('');
    pollAoriStatus();
  } catch (e) {
    setStatus('Aori bridge failed: ' + (e.reason || e.message || '').slice(0, 140), 'error');
    btn.disabled = false;
    btn.textContent = 'Bridge via Aori';
  }
}

async function pollAoriStatus() {
  clearInterval(state.statusTimer);
  const orderHash = state.quote.orderHash;
  const tick = async () => {
    try {
      const s = await api(`/api/aori/status?orderHash=${orderHash}`);
      const st = String(s.status || '').toLowerCase();
      if (st === 'completed' || st === 'filled') {
        renderSteps(3);
        $('statusBox').innerHTML = `<div class="status success">Bridged ✓ ${Number(ethers.formatUnits(BigInt(state.quote.order.outputAmount), state.quote.ti.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${state.quote.ti.symbol} on ${BRIDGE_CHAINS[state.toChain].label}</div>`;
        setStatus('Done ✓', 'success');
        clearInterval(state.statusTimer);
      } else if (['failed', 'cancelled', 'expired'].includes(st)) {
        renderSteps(1, true);
        $('statusBox').innerHTML = `<div class="status error">Bridge ${st}</div>`;
        clearInterval(state.statusTimer);
      } else {
        renderSteps(1);
        $('statusBox').innerHTML = `<div class="status"><span class="spinner"></span>${st || 'pending'}…</div>`;
      }
    } catch (e) {
      $('statusBox').innerHTML = `<div class="status warn">Status check failed: ${e.message.slice(0, 80)} — retrying…</div>`;
    }
  };
  await tick();
  state.statusTimer = setInterval(tick, 5000);
}

/* ---------------- events ---------------- */
function bindEvents() {
  $('bridgeBtn').onclick = startBridge;
  $('bridgeSource').addEventListener('change', e => {
    state.source = e.target.value;
    state.quote = null; state.intent = null;
    $('depositCard').style.display = 'none';
    $('statusCard').style.display = 'none';
    clearInterval(state.statusTimer);
    renderChains();
    refreshTokens('from');
    refreshTokens('to');
  });
  $('fromChain').addEventListener('change', e => { state.fromChain = e.target.value; refreshTokens('from'); });
  $('toChain').addEventListener('change', e => { state.toChain = e.target.value; refreshTokens('to'); });
  $('fromToken').addEventListener('change', () => { updateBalance(); scheduleQuote(); });
  $('toToken').addEventListener('change', scheduleQuote);
  $('fromAmount').addEventListener('input', scheduleQuote);
  $('flipBtn').onclick = () => {
    [state.fromChain, state.toChain] = [state.toChain, state.fromChain];
    $('fromChain').value = state.fromChain; $('toChain').value = state.toChain;
    [state.fromTokens, state.toTokens] = [state.toTokens, state.fromTokens];
    const fi = $('fromToken').value, ti = $('toToken').value;
    fillTokenSelect($('fromToken'), state.fromTokens); fillTokenSelect($('toToken'), state.toTokens);
    if (state.fromTokens[Number(ti)]) $('fromToken').value = ti;
    if (state.toTokens[Number(fi)]) $('toToken').value = fi;
    // Stargate is same-asset only — keep the pair matched after flipping.
    if (state.source === 'stargate') {
      const sym = (state.fromTokens[Number($('fromToken').value)] || {}).symbol;
      const matchIdx = state.toTokens.findIndex(t => t.symbol === sym);
      if (matchIdx >= 0) $('toToken').value = String(matchIdx);
    }
    updateBalance(); scheduleQuote();
  };
  $('maxBtn').onclick = async () => {
    const addr = getAddress();
    if (!addr) return;
    const { fi } = selTokens();
    if (!fi) return;
    try {
      const cfg = BRIDGE_CHAINS[state.fromChain];
      const p = new ethers.JsonRpcProvider(cfg.rpcs[0]);
      if (!fi.address) {
        const bal = await p.getBalance(addr);
        $('fromAmount').value = ethers.formatUnits(bal * 95n / 100n, 18); // keep gas
      } else {
        const c = new ethers.Contract(fi.address, ERC20_ABI, p);
        $('fromAmount').value = ethers.formatUnits(await c.balanceOf(addr), fi.decimals);
      }
      scheduleQuote();
    } catch { /* ignore */ }
  };
}

subscribeToAccountChanges(() => { updateBalance(); scheduleQuote(); });

/* ---------------- init ---------------- */
if (document.getElementById('bBridgeBtn')) {
  renderChains();
  bindEvents();
  (async () => {
    try {
      await Promise.all([refreshTokens('from'), refreshTokens('to')]);
    } catch (e) {
      $('quoteBox').innerHTML = `<div class="status error">Could not load bridge tokens: ${e.message.slice(0, 100)}</div>`;
    }
  })();
}
