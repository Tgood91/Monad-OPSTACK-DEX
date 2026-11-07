// Merkl Rewards tab: views + claiming.
// Views: your rewards per chain (claimable / pending / already claimed) and
// the top live opportunities on a chain. Data comes from /api/merkl/* — the
// backend proxies Merkl's keyless read API and builds claim calldata.
// Claiming: the backend returns a ready-to-sign Distributor.claim payload;
// THIS tab asks your wallet to switch to the chain and sign it. Your keys
// never leave your wallet; nothing here can move funds on its own.

import { getAddress, getSigner, getWalletEthersProvider, simulateTx } from './utils/web3.js';
import { appKit, appKitNetworkForChainId } from './config.js';
import { runClaim } from './merkl-claim.js';
import { chainBlock, CHAIN_NAMES, fmt, fmtUsd } from './merkl-view.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const EXPLORERS = { 1: 'https://etherscan.io', 8453: 'https://basescan.org', 143: 'https://monadscan.com', 10: 'https://optimistic.etherscan.io' };

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

async function claim(chainId) {
  if (claiming) return;
  const addr = getAddress();
  if (!addr) { setStatus('<div class="status error">Connect a wallet first.</div>'); return; }
  claiming = true;
  const ex = EXPLORERS[chainId] || '';
  const list = (j) => j.tokens.map(t => `${fmt(t.claimable)} ${esc(t.symbol)}`).join(', ');
  const say = (h) => setStatus(`<div class="status">${h}</div>`);
  try {
    const r = await runClaim({
      chainId, address: addr,
      fetchClaim: (a, id) => api(`/api/merkl/claim-data?address=${a}&chainId=${id}`),
      getChainId: async () => (await getWalletEthersProvider().getNetwork()).chainId,
      switchChain: async (id) => {
        const net = appKitNetworkForChainId(id);
        if (!net) throw new Error(`Switch your wallet to ${CHAIN_NAMES[id] || id} and try again.`);
        await appKit.switchNetwork(net);
      },
      simulate: ({ to, data, from }) => simulateTx({ to, data, value: 0n, from }),
      send: async ({ to, data }) => (await getSigner()).sendTransaction({ to, data }),
      onStage: (stage, j, tx) => {
        if (stage === 'build') say('<span class="spinner"></span>Building claim from live proofs…');
        if (stage === 'switch') say(`<span class="spinner"></span>Switching your wallet to ${esc(CHAIN_NAMES[chainId] || chainId)}…`);
        if (stage === 'simulate') say('<span class="spinner"></span>Checking the claim will succeed…');
        if (stage === 'sign') say(`Claiming ${list(j)} (${fmtUsd(j.totalUsd)}). Confirm in your wallet…`);
        if (stage === 'wait') say(`Sent: ${ex ? `<a href="${ex}/tx/${tx.hash}" target="_blank" rel="noopener">${esc(tx.hash.slice(0, 18))}…</a>` : esc(tx.hash)}. Waiting for confirmation…`);
      },
    });
    if (!r.claimed) { say(esc(r.reason)); return; }
    say(`Claimed ${r.tokens.map(t => `${fmt(t.claimable)} ${esc(t.symbol)}`).join(', ')} on ${esc(CHAIN_NAMES[chainId] || chainId)}. ✔`);
    loadRewards();
  } catch (e) {
    setStatus(`<div class="status error">Claim failed: ${esc(String(e.shortMessage || e.reason || e.message || e).slice(0, 200))}</div>`);
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
