// Merkl Rewards tab: views + claiming.
// Views: your rewards per chain (claimable / pending / already claimed) and
// the top live opportunities on a chain. Data comes from /api/merkl/* — the
// backend proxies Merkl's keyless read API and builds claim calldata.
// Claiming: the backend returns a ready-to-sign Distributor.claim payload;
// THIS tab asks your wallet to switch to the chain and sign it. Your keys
// never leave your wallet; nothing here can move funds on its own.

import { ethers } from 'ethers';
import { getAddress, getWalletEthersProvider } from './utils/web3.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CHAIN_NAMES = { 1: 'Ethereum', 8453: 'Base', 143: 'Monad', 10: 'Optimism' };
const EXPLORERS = { 1: 'https://etherscan.io', 8453: 'https://basescan.org', 143: 'https://monadscan.com', 10: 'https://optimistic.etherscan.io' };

const fmt = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
const fmtUsd = n => (n > 0 && n < 0.01 ? '<$0.01' : '$' + Number(n || 0).toFixed(2));

let bound = false;
let claiming = false;

async function api(path) {
  const r = await fetch(path);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `API ${r.status}`);
  return j;
}

function setStatus(html) { $('merklStatus').innerHTML = html; }

/* ---------------- rewards ---------------- */

async function loadRewards() {
  const box = $('merklRewards');
  const addr = getAddress();
  if (!addr) {
    box.innerHTML = '<div class="status">Connect a wallet to see your Merkl rewards.</div>';
    return;
  }
  box.innerHTML = '<div class="status"><span class="spinner"></span>Loading rewards…</div>';
  try {
    const j = await api(`/api/merkl/rewards?address=${addr}`);
    box.innerHTML = (j.chains || []).map(chainBlock).join('') ||
      '<div class="status">No rewards found.</div>';
    box.querySelectorAll('[data-claim]').forEach(b => { b.onclick = () => claim(Number(b.dataset.claim)); });
  } catch (e) {
    box.innerHTML = `<div class="status error">Failed: ${esc(e.message.slice(0, 120))}</div>`;
  }
}

function chainBlock(c) {
  const name = CHAIN_NAMES[c.chainId] || `Chain ${c.chainId}`;
  if (c.error) return `<div class="status error">${esc(name)}: ${esc(c.error)}</div>`;
  const live = (c.rewards || []).filter(r => r.claimable > 0 || r.pending > 0);
  const claimedCount = (c.rewards || []).length - live.length;
  const ready = (c.rewards || []).some(r => r.claimReady);
  const rows = live.map(r => `<tr>
      <td>${esc(r.symbol)}</td>
      <td>${fmt(r.claimable)}</td>
      <td>${fmtUsd(r.claimableUsd)}</td>
      <td>${r.pending > 0 ? fmt(r.pending) + ' pending' : (r.claimReady ? 'ready' : '—')}</td>
    </tr>`).join('');
  return `<div style="margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <strong>${esc(name)}</strong>
      ${ready ? `<button class="btn btn-swap" data-claim="${c.chainId}" style="width:auto;padding:8px 16px;">Claim ${fmtUsd(c.claimableUsd)}</button>` : ''}
    </div>
    ${rows ? `<div class="intel-table-wrap"><table class="intel-table"><thead><tr><th>Token</th><th>Claimable</th><th>Value</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`
           : '<div class="status">Nothing claimable here.</div>'}
    ${claimedCount > 0 ? `<div class="status" style="text-align:left;">${claimedCount} token${claimedCount === 1 ? '' : 's'} already fully claimed</div>` : ''}
  </div>`;
}

async function claim(chainId) {
  if (claiming) return;
  const addr = getAddress();
  if (!addr) { setStatus('<div class="status error">Connect a wallet first.</div>'); return; }
  claiming = true;
  try {
    setStatus('<div class="status"><span class="spinner"></span>Building claim from live proofs…</div>');
    const j = await api(`/api/merkl/claim-data?address=${addr}&chainId=${chainId}`);
    if (!j.claimable) {
      setStatus(`<div class="status">${esc(j.reason || 'Nothing claimable right now.')}</div>`);
      return;
    }
    const list = j.tokens.map(t => `${fmt(t.claimable)} ${esc(t.symbol)}`).join(', ');
    setStatus(`<div class="status">Claiming ${esc(list)} (${fmtUsd(j.totalUsd)}) — confirm in your wallet…</div>`);
    const wp = getWalletEthersProvider();
    if (!wp) throw new Error('wallet provider not available');
    const current = await wp.request({ method: 'eth_chainId' }).catch(() => null);
    if (Number(current) !== chainId) {
      await wp.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + chainId.toString(16) }] });
    }
    const signer = await new ethers.BrowserProvider(wp).getSigner();
    const tx = await signer.sendTransaction({ to: j.to, data: j.data });
    const ex = EXPLORERS[chainId] || '';
    setStatus(`<div class="status">Sent: ${ex ? `<a href="${ex}/tx/${tx.hash}" target="_blank" rel="noopener">${esc(tx.hash.slice(0, 18))}…</a>` : esc(tx.hash)} — waiting for confirmation…</div>`);
    await tx.wait();
    setStatus(`<div class="status">Claimed ${esc(list)} on ${esc(CHAIN_NAMES[chainId] || chainId)}. ✔</div>`);
    loadRewards();
  } catch (e) {
    setStatus(`<div class="status error">Claim failed: ${esc(String(e.message || e).slice(0, 160))}</div>`);
  } finally {
    claiming = false;
  }
}

/* ---------------- opportunities ---------------- */

async function loadOpps() {
  const box = $('merklOpps');
  const chainId = Number($('merklOppChain').value || 8453);
  box.innerHTML = '<div class="status"><span class="spinner"></span>Loading opportunities…</div>';
  try {
    const list = await api(`/api/merkl/opportunities?chainId=${chainId}&items=15`);
    if (!list.length) { box.innerHTML = '<div class="status">No live opportunities on this chain.</div>'; return; }
    const rows = list.map(o => `<tr>
        <td>${esc(o.name || '—')}${o.protocol ? ` <span style="color:var(--muted);">· ${esc(o.protocol)}</span>` : ''}</td>
        <td>${o.apr ? o.apr.toFixed(2) + '%' : '—'}</td>
        <td>$${Math.round(o.tvl).toLocaleString('en-US')}</td>
        <td>$${Math.round(o.dailyRewards).toLocaleString('en-US')}</td>
      </tr>`).join('');
    box.innerHTML = `<div class="intel-table-wrap"><table class="intel-table"><thead><tr><th>Opportunity</th><th>APR</th><th>TVL</th><th>Rewards/day</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch (e) {
    box.innerHTML = `<div class="status error">Failed: ${esc(e.message.slice(0, 120))}</div>`;
  }
}

/* ---------------- entry ---------------- */

export function showMerkl() {
  if (!bound) {
    bound = true;
    $('merklOppChain').addEventListener('change', loadOpps);
    $('merklRefresh').onclick = () => { loadRewards(); loadOpps(); };
  }
  loadRewards();
  loadOpps();
}
