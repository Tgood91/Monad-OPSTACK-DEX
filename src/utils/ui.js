// UI helpers: status toasts, formatting, loading states.

import { ethers } from 'ethers';

const statusEl = () => document.getElementById('txStatus');

export function showStatus(message, type = 'info') {
  const el = statusEl();
  if (!el) return;
  el.className = `status ${type}`;
  el.innerHTML = message;
}

export function showLoading(message = 'Working…') {
  showStatus(`<span class="spinner"></span>${message}`, 'info');
}

export function clearStatus() {
  const el = statusEl();
  if (el) { el.className = 'status'; el.innerHTML = ''; }
}

export function fmtAmount(wei, decimals) {
  try {
    const n = parseFloat(ethers.formatUnits(wei, decimals));
    if (n === 0) return '0';
    if (n < 0.0001) return n.toExponential(2);
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  } catch {
    return '—';
  }
}

export function fmtUsd(n) {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function setButtonLoading(btn, loading, idleText) {
  if (!btn) return;
  if (loading) {
    btn.dataset.idle = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Working…';
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.idle || idleText || 'Submit';
  }
}

export function explorerTxUrl(chainKey, hash) {
  // lazy import to avoid cycle
  return import('../dex/chains.js').then(m => `${m.CHAINS[chainKey].explorer}/tx/${hash}`);
}

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
