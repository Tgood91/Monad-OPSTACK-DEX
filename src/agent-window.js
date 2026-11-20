// Agent tab: run a paid Bushido-Trades job from the connected wallet.
//
// 1. Ask the server for the job's payment requirements (GET /api/agent/job).
// 2. Check the wallet holds the USDC (read from our public Base RPCs, not the wallet's connection).
// 3. The wallet signs the payment (a signature, no gas). The server runs the job and only then
//    collects the payment, so a failed job costs nothing.
// 4. Show the Seykota x Druckenmiller signal and the Base swap quote. "Open in Swap" hands the
//    trade to the Swap tab, which dry-runs it before asking the wallet to sign anything.

import { ethers } from 'ethers';
import {
  getAddress,
  isConnected,
  getSigner,
  getWalletChainKey,
  switchNetwork,
  getTokenBalance,
  openConnect,
} from './utils/web3.js';
import { switchAndConfirm } from './bushido-swap.js';
import {
  checkRequirements,
  buildAuthorization,
  typedData,
  paymentHeader,
  describeResult,
  fmtUnits,
} from './agent-core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let info = null; // GET /api/agent/job answer
let busy = false;
let mounted = false;

function setStatus(text, tone = '') {
  $('agentStatus').className = `status ${tone}`;
  $('agentStatus').innerHTML = text;
}

async function loadInfo() {
  try {
    const r = await fetch('/api/agent/job');
    info = await r.json();
    if (!r.ok) throw new Error(info.error || `API ${r.status}`);
  } catch (e) {
    info = null;
    setStatus(`Could not reach the agent: ${esc(String(e.message).slice(0, 120))}`, 'error');
    $('agentRun').disabled = true;
    return;
  }
  const req = info.accepts?.[0];
  const price = req ? fmtUnits(req.maxAmountRequired, 6) : '?';
  $('agentPrice').textContent = `${price} USDC per job, paid on Base`;
  if (info.payments !== 'enabled') {
    setStatus('The agent is not taking payments yet, so jobs cannot run.', 'warn');
    $('agentRun').disabled = true;
    return;
  }
  $('agentRun').disabled = false;
  setStatus(isConnected() ? '' : 'Connect a wallet on Base to run a job.');
}

async function run() {
  if (busy) return;
  if (!isConnected()) return openConnect();
  const req = info?.accepts?.[0];
  const bad = checkRequirements(req);
  if (bad) return setStatus(esc(bad), 'error');
  const amountUsd = Number($('agentAmount').value);
  if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 10000)
    return setStatus('Enter a trade size between $1 and $10,000.', 'warn');

  busy = true;
  $('agentRun').disabled = true;
  $('agentResult').innerHTML = '';
  try {
    const from = getAddress();
    setStatus('<span class="spinner"></span>Checking your USDC on Base…');
    const bal = await getTokenBalance(req.asset, from, 'base');
    if (bal.raw < BigInt(req.maxAmountRequired))
      throw new Error(`You need ${fmtUnits(req.maxAmountRequired, 6)} USDC on Base; you have ${fmtUnits(bal.raw, 6)}.`);

    setStatus('<span class="spinner"></span>Switching your wallet to Base…');
    await switchAndConfirm({ chainKey: 'base', label: 'Base', getChainKey: getWalletChainKey, switchNetwork });

    setStatus(
      `<span class="spinner"></span>Sign the ${fmtUnits(req.maxAmountRequired, 6)} USDC payment in your wallet (no gas)…`,
    );
    const auth = buildAuthorization({
      from,
      req,
      now: Math.floor(Date.now() / 1000),
      nonce: ethers.hexlify(ethers.randomBytes(32)),
    });
    const td = typedData(req, auth);
    const signer = await getSigner();
    const signature = await signer.signTypedData(td.domain, td.types, td.message);

    setStatus('<span class="spinner"></span>Running the job…');
    const r = await fetch('/api/agent/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': paymentHeader(req, auth, signature) },
      body: JSON.stringify({ asset: 'ETH', amountUsd, taker: from }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const charged = r.status === 502 && j.charged === false ? ' You were not charged.' : '';
      throw new Error(`${j.error || `Agent error ${r.status}`}.${charged}`);
    }
    render(describeResult(j));
    setStatus('Job done ✓', 'success');
  } catch (e) {
    const msg = String(e?.shortMessage || e?.message || e);
    const refused = /user rejected|denied|ACTION_REJECTED/i.test(msg);
    setStatus(
      esc(refused ? 'You declined the signature. Nothing was paid.' : msg.slice(0, 220)),
      refused ? 'warn' : 'error',
    );
  } finally {
    busy = false;
    $('agentRun').disabled = false;
  }
}

function row(k, v) {
  return `<div class="agent-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
}

function render(v) {
  const quote = v.quote
    ? `<div class="agent-sub">Swap quote on Base (${esc(v.quote.source)})</div>` +
      row('You sell', v.quote.sell) +
      row('You get about', v.quote.buy) +
      (v.quote.min ? row('At least', v.quote.min) : '') +
      '<button class="btn btn-secondary" id="agentOpenSwap">Open in Swap (dry-run first)</button>'
    : `<div class="status warn">${esc(v.note || 'No trade suggested right now.')}</div>`;
  const tx = v.paymentTx
    ? `<a class="agent-tx" href="https://basescan.org/tx/${encodeURIComponent(v.paymentTx)}" target="_blank" rel="noopener">Payment on Basescan ↗</a>`
    : '';
  $('agentResult').innerHTML =
    `<div class="agent-verdict status ${v.tone}">${esc(v.verdict)}</div>` +
    row('ETH price', v.price) +
    row('Druckenmiller regime', v.regime) +
    row('Seykota trend', v.seykota) +
    row('Virtue gate', v.gate) +
    quote +
    tx;
  const open = $('agentOpenSwap');
  if (open && v.prefill)
    open.onclick = () => window.dispatchEvent(new CustomEvent('bushido:prefill-swap', { detail: v.prefill }));
}

export function showAgent() {
  if (!mounted) {
    mounted = true;
    $('agentRun').onclick = run;
  }
  loadInfo();
}
