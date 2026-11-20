// Agent tab: talk to Bushido-Trades and hire it from the connected wallet.
//
// 1. The profile and status come from the server (GET /api/agent/job): name, what it does, price, which quote
//    sources it uses, and whether it is taking jobs right now.
// 2. Hiring: check the wallet holds the USDC (read from our public Base RPCs, not the wallet's connection), move
//    the wallet to Base, sign the payment (a signature, no gas), then POST the job. The server runs it and only
//    then collects the payment, so a failed job costs nothing.
// 3. The result appears in the conversation. "Open in Swap" hands the trade to the Swap tab, which quotes it
//    again and dry-runs it before the wallet is asked to sign anything.

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
  describeStatus,
  greeting,
  fmtUnits,
  sourceName,
  resultHtml,
  esc,
} from './agent-core.js';

const $ = (id) => document.getElementById(id);

let info = null; // GET /api/agent/job answer
let status = describeStatus(null);
let busy = false;
let mounted = false;

/* ---------------- conversation ---------------- */

function say(who, html) {
  const el = document.createElement('div');
  el.className = `agent-msg ${who === 'me' ? 'me' : ''}`;
  el.innerHTML = html;
  $('agentChat').appendChild(el);
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return el;
}

/* ---------------- profile + status ---------------- */

function renderProfile() {
  const a = info?.agent;
  $('agentName').textContent = a?.name || 'Bushido-Trades';
  $('agentChip').textContent = status.chip;
  $('agentChip').className = `agent-chip ${status.tone}`;
  $('agentAbout').textContent = a?.description || '';
  const price = status.price ? `${status.price} USDC per job · paid on Base` : '';
  const src = (a?.sources || []).map(sourceName).join(' · ');
  $('agentMeta').innerHTML =
    (price ? `<div>${esc(price)}</div>` : '') +
    (src ? `<div>Quotes from ${esc(src)}</div>` : '') +
    (a?.agentId != null
      ? `<div>ERC-8004 agent #${esc(a.agentId)} · <a href="https://basescan.org/token/${esc(a.registry)}?a=${esc(a.agentId)}" target="_blank" rel="noopener">registry ↗</a></div>`
      : '');
  $('agentHire').disabled = !status.canHire || busy;
  $('agentHire').textContent = status.price ? `Hire for ${status.price} USDC` : 'Hire';
  setHint(
    status.canHire ? (isConnected() ? '' : 'Connect a wallet to hire the agent.') : status.text,
    status.canHire ? '' : status.tone,
  );
}

function setHint(text, tone = '') {
  $('agentHint').className = `status ${tone}`;
  $('agentHint').textContent = text;
}

async function loadInfo() {
  try {
    const r = await fetch('/api/agent/job');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `API ${r.status}`);
    info = j;
    status = describeStatus(info);
  } catch (e) {
    info = null;
    status = { ...describeStatus(null), text: `The agent is not answering: ${String(e.message).slice(0, 100)}` };
  }
  renderProfile();
  if (!$('agentChat').children.length && info) say('agent', esc(greeting(info)));
}

/* ---------------- hiring ---------------- */

async function hire() {
  if (busy) return;
  if (!isConnected()) return openConnect();
  const req = info?.accepts?.[0];
  const bad = checkRequirements(req);
  if (bad) return setHint(bad, 'error');
  const amountUsd = Number($('agentAmount').value);
  if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 10000)
    return setHint('Enter a trade size between $1 and $10,000.', 'warn');

  busy = true;
  $('agentHire').disabled = true;
  setHint('');
  say('me', esc(`Hire: ETH signal and the best Base quote for a $${amountUsd.toLocaleString()} trade.`));
  const reply = say('agent', '<span class="spinner"></span>Checking your USDC on Base…');
  const progress = (t) => (reply.innerHTML = `<span class="spinner"></span>${esc(t)}`);
  try {
    const from = getAddress();
    const price = fmtUnits(req.maxAmountRequired, 6);
    const bal = await getTokenBalance(req.asset, from, 'base');
    if (bal.raw < BigInt(req.maxAmountRequired))
      throw new Error(`You need ${price} USDC on Base to hire me; this wallet has ${fmtUnits(bal.raw, 6)}.`);

    progress('Moving your wallet to Base…');
    await switchAndConfirm({ chainKey: 'base', label: 'Base', getChainKey: getWalletChainKey, switchNetwork });

    progress(`Sign the ${price} USDC payment in your wallet. It's a signature, no gas.`);
    const auth = buildAuthorization({
      from,
      req,
      now: Math.floor(Date.now() / 1000),
      nonce: ethers.hexlify(ethers.randomBytes(32)),
    });
    const td = typedData(req, auth);
    const signer = await getSigner();
    const signature = await signer.signTypedData(td.domain, td.types, td.message);

    progress('Reading the macro regime and the ETH trend, then asking every quote source…');
    const r = await fetch('/api/agent/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': paymentHeader(req, auth, signature) },
      body: JSON.stringify({ asset: 'ETH', amountUsd, taker: from }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const notCharged = j.charged === false || r.status === 402 || r.status === 409 ? ' You were not charged.' : '';
      throw new Error(`${j.error || `Agent error ${r.status}`}.${notCharged}`);
    }
    const v = describeResult(j);
    reply.innerHTML = resultHtml(v);
    const open = reply.querySelector('.agent-open');
    if (open && v.prefill)
      open.onclick = () => window.dispatchEvent(new CustomEvent('bushido:prefill-swap', { detail: v.prefill }));
  } catch (e) {
    const msg = String(e?.shortMessage || e?.message || e);
    const declined = /user rejected|denied|ACTION_REJECTED/i.test(msg);
    reply.innerHTML = `<div class="agent-note ${declined ? '' : 'agent-err'}">${esc(
      declined ? 'You declined the signature. Nothing was paid.' : msg.slice(0, 240),
    )}</div>`;
  } finally {
    busy = false;
    $('agentHire').disabled = !status.canHire;
  }
}

export function showAgent() {
  if (!mounted) {
    mounted = true;
    $('agentHire').onclick = hire;
    for (const b of document.querySelectorAll('#agentPane [data-usd]'))
      b.onclick = () => ($('agentAmount').value = b.dataset.usd);
  }
  loadInfo();
}
