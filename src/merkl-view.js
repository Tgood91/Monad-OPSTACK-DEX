// HTML for one chain's rewards block on the Rewards tab (pure: no wallet, no DOM).
// The Claim button is ALWAYS shown. It is active when something can be claimed and
// otherwise says why not, so it never looks missing.

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
export const fmtUsd = (n) => (n > 0 && n < 0.01 ? '<$0.01' : '$' + Number(n || 0).toFixed(2));

export const CHAIN_NAMES = { 1: 'Ethereum', 8453: 'Base', 143: 'Monad', 10: 'Optimism' };

// Ethereum gas can cost more than a few cents of rewards.
const ETH_DUST_USD = 1;

export function chainBlock(c) {
  const name = CHAIN_NAMES[c.chainId] || `Chain ${c.chainId}`;
  // A read that failed is usually a brief hiccup at Merkl, so it is amber, not red.
  if (c.error)
    return `<div class="status warn">${esc(name)}: couldn't load right now (${esc(c.error)}). Tap Refresh.</div>`;
  const rewards = c.rewards || [];
  const live = rewards.filter((r) => r.claimable > 0 || r.pending > 0);
  const claimedCount = rewards.length - live.length;
  const ready = rewards.some((r) => r.claimReady);
  const hasPending = rewards.some((r) => r.pending > 0);
  const rows = live
    .map(
      (r) => `<tr>
      <td>${esc(r.symbol)}</td>
      <td>${fmt(r.claimable)}</td>
      <td>${fmtUsd(r.claimableUsd)}</td>
      <td title="${r.pending > 0 ? esc(fmt(r.pending)) + ' more pending' : ''}">${r.claimReady ? 'ready' : r.pending > 0 ? 'pending' : '—'}</td>
    </tr>`,
    )
    .join('');

  const button = ready
    ? `<button class="btn btn-swap" data-claim="${c.chainId}" style="width:auto;padding:8px 16px;">Claim ${fmtUsd(c.claimableUsd)}</button>`
    : `<button class="btn btn-swap" disabled style="width:auto;padding:8px 16px;">${hasPending ? 'Not ready yet' : 'Nothing to claim'}</button>`;
  const hint =
    !ready && hasPending
      ? '<div class="status" style="text-align:left;">New rewards unlock at the next Merkl update (about every 8 hours).</div>'
      : ready && c.chainId === 1 && c.claimableUsd < ETH_DUST_USD
        ? `<div class="status warn" style="text-align:left;">Ethereum gas can cost more than ${fmtUsd(c.claimableUsd)}. Claim only if it is worth the fee.</div>`
        : '';

  return `<div style="margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <strong>${esc(name)}</strong>
      ${button}
    </div>
    ${hint}
    ${
      rows
        ? `<div class="intel-table-wrap"><table class="intel-table"><thead><tr><th>Token</th><th>Claimable</th><th>Value</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<div class="status">Nothing claimable here.</div>'
    }
    ${claimedCount > 0 ? `<div class="status" style="text-align:left;">${claimedCount} token${claimedCount === 1 ? '' : 's'} already fully claimed</div>` : ''}
  </div>`;
}
