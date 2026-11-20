// Agent tab: a terminal where people tell Bushido-Trades which coin they want their money in, and hire it.
//
// 1. The profile and status come from the server (GET /api/agent/job): name, what it does, price, which quote
//    sources it uses, and whether it is taking jobs right now.
// 2. Commands are read by src/agent-terminal.js against the verified Base coin list. A swap request becomes a plan
//    first; only "hire" (or the Hire button) asks for the payment.
// 3. Hiring: check the wallet holds the USDC (read from our public Base RPCs, not the wallet's connection), move
//    the wallet to Base, sign the payment (a signature, no gas), then POST the job. The server runs it and only
//    then collects the payment, so a failed job costs nothing.
// 4. "open" hands the result to the Swap tab, which quotes it again and dry-runs it before any signature.
// Output is written as text (textContent), never as HTML.

import { ethers } from 'ethers';
import { CHAINS } from './dex/chains.js';
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
  esc,
} from './agent-core.js';
import { parseCommand, helpLines, coinLines, planLines, swapResultLines, signalResultLines } from './agent-terminal.js';

const $ = (id) => document.getElementById(id);
const TOKENS = CHAINS.base.tokens;

let info = null; // GET /api/agent/job answer
let status = describeStatus(null);
let busy = false;
let mounted = false;
let plan = null; // the swap (or ETH signal) waiting for "hire"
let lastPrefill = null; // the last result, for "open"

/* ---------------- terminal output ---------------- */

function scrollDown() {
  const term = $('agentTerm');
  term.scrollTop = term.scrollHeight;
}

function print(lines) {
  const term = $('agentTerm');
  for (const l of [].concat(lines)) {
    const el = document.createElement('div');
    el.className = `term-line ${l.cls || ''}`;
    el.textContent = l.text;
    term.appendChild(el);
  }
  scrollDown();
}

function printLink(text, href) {
  const el = document.createElement('div');
  el.className = 'term-line';
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  el.appendChild(a);
  $('agentTerm').appendChild(el);
  scrollDown();
}

// One "working" line, replaced as the job moves on.
function progress(text) {
  let el = $('agentTerm').querySelector('.term-line.work');
  if (!el) {
    el = document.createElement('div');
    el.className = 'term-line work';
    $('agentTerm').appendChild(el);
  }
  el.textContent = `… ${text}`;
  scrollDown();
}

const endProgress = () => $('agentTerm').querySelector('.term-line.work')?.remove();

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
  const hire = $('agentHire');
  hire.disabled = !status.canHire || busy || !plan;
  hire.textContent = plan ? `Hire for ${status.price || '0.01'} USDC` : 'Hire (tell me a swap first)';
  const hint = !status.canHire ? status.text : !isConnected() ? 'Connect a wallet to hire the agent.' : '';
  $('agentHint').className = `status ${status.canHire ? '' : status.tone}`;
  $('agentHint').textContent = hint;
}

function statusLines() {
  const out = [{ text: `Bushido-Trades: ${status.chip}`, cls: status.canHire ? 'ok' : 'warn' }];
  if (status.price) out.push({ text: `${status.price} USDC per job, paid on Base` });
  const src = (info?.agent?.sources || []).map(sourceName);
  if (src.length) out.push({ text: `Quotes from ${src.join(', ')}` });
  if (status.text) out.push({ text: status.text, cls: 'dim' });
  return out;
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
  if (!$('agentTerm').children.length) {
    if (info) print([{ text: greeting(info) }, { text: 'Type help for examples.', cls: 'dim' }]);
    else print({ text: status.text, cls: 'warn' });
  }
}

/* ---------------- commands ---------------- */

function run(text) {
  const cmd = String(text || '').trim();
  if (!cmd) return;
  print({ text: `> ${cmd}`, cls: 'in' });
  const r = parseCommand(cmd, TOKENS);
  switch (r.kind) {
    case 'help':
      return print(helpLines(status.price || '0.01'));
    case 'coins':
      return print(coinLines(TOKENS, r.filter));
    case 'status':
      return print(statusLines());
    case 'clear':
      $('agentTerm').textContent = '';
      return;
    case 'cancel':
      plan = null;
      renderProfile();
      return print({ text: 'OK, nothing planned.', cls: 'dim' });
    case 'open':
      if (!lastPrefill) return print({ text: 'Nothing to open yet. Hire me for a swap first.', cls: 'warn' });
      window.dispatchEvent(new CustomEvent('bushido:prefill-swap', { detail: lastPrefill }));
      return;
    case 'hire':
      return hire();
    case 'swap':
    case 'signal':
      plan = r;
      renderProfile();
      return print(planLines(r, { price: status.price || '0.01', sources: info?.agent?.sources || [] }));
    case 'error':
      return print([{ text: r.message, cls: 'warn' }, ...(r.hint ? [{ text: r.hint, cls: 'dim' }] : [])]);
    default:
      return;
  }
}

/* ---------------- hiring ---------------- */

async function hire() {
  if (busy) return;
  if (!plan) return print({ text: 'Tell me what to swap first, e.g. swap 100 USDC to AERO.', cls: 'warn' });
  if (!status.canHire) return print({ text: status.text || 'Hiring is paused right now.', cls: 'warn' });
  if (!isConnected()) {
    print({ text: 'Connect a wallet to hire me, then type hire again.', cls: 'warn' });
    return openConnect();
  }
  const req = info?.accepts?.[0];
  const bad = checkRequirements(req);
  if (bad) return print({ text: bad, cls: 'err' });

  const job = plan;
  busy = true;
  renderProfile();
  try {
    const from = getAddress();
    const price = fmtUnits(req.maxAmountRequired, 6);
    progress('Checking your USDC on Base');
    const bal = await getTokenBalance(req.asset, from, 'base');
    if (bal.raw < BigInt(req.maxAmountRequired))
      throw new Error(`You need ${price} USDC on Base to hire me; this wallet has ${fmtUnits(bal.raw, 6)}.`);

    progress('Moving your wallet to Base');
    await switchAndConfirm({ chainKey: 'base', label: 'Base', getChainKey: getWalletChainKey, switchNetwork });

    progress(`Sign the ${price} USDC payment in your wallet (a signature, no gas)`);
    const auth = buildAuthorization({
      from,
      req,
      now: Math.floor(Date.now() / 1000),
      nonce: ethers.hexlify(ethers.randomBytes(32)),
    });
    const td = typedData(req, auth);
    const signer = await getSigner();
    const signature = await signer.signTypedData(td.domain, td.types, td.message);

    progress(
      job.kind === 'swap'
        ? `Reading the market and asking every source for ${job.amount} ${job.sell.symbol} → ${job.buy.symbol}`
        : 'Reading the market and the ETH trend, then asking every source',
    );
    const body =
      job.kind === 'swap'
        ? { sell: job.sell.symbol, buy: job.buy.symbol, amount: job.amount, taker: from }
        : { asset: 'ETH', amountUsd: job.amountUsd, taker: from };
    const r = await fetch('/api/agent/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': paymentHeader(req, auth, signature) },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const notCharged = j.charged === false || r.status === 402 || r.status === 409 ? ' You were not charged.' : '';
      throw new Error(`${j.error || `Agent error ${r.status}`}.${notCharged}`);
    }
    endProgress();
    const out = j.mode === 'swap' ? swapResultLines(j) : signalResultLines(describeResult(j));
    print(out.lines);
    const tx = j.payment?.transaction;
    if (/^0x[0-9a-fA-F]{64}$/.test(String(tx || '')))
      printLink(`Payment on Basescan${j.payment.pending ? ' (confirming)' : ''} ↗`, `https://basescan.org/tx/${tx}`);
    lastPrefill = out.prefill;
    plan = null;
  } catch (e) {
    endProgress();
    const msg = String(e?.shortMessage || e?.message || e);
    const declined = /user rejected|denied|ACTION_REJECTED/i.test(msg);
    print({
      text: declined ? 'You declined the signature. Nothing was paid.' : msg.slice(0, 240),
      cls: declined ? 'warn' : 'err',
    });
  } finally {
    busy = false;
    renderProfile();
  }
}

export function showAgent() {
  if (!mounted) {
    mounted = true;
    $('agentCmdForm').onsubmit = (e) => {
      e.preventDefault();
      const v = $('agentCmd').value;
      $('agentCmd').value = '';
      run(v);
    };
    $('agentHire').onclick = () => run('hire');
    for (const b of document.querySelectorAll('#agentPane [data-cmd]')) b.onclick = () => run(b.dataset.cmd);
  }
  loadInfo();
}
