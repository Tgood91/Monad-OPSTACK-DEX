// Bridge health strip: polls /api/bridge/health and renders one chip per
// bridge source (live / degraded / down / unknown) with its probe routes
// underneath. The backend probes each source with a real 1-USDC quote — a
// live quote means deposits are open on the source chain and payout is
// available on the destination right now. Read-only; nothing here moves funds.

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DOT = { live: '#35d07f', degraded: '#f5b544', down: '#ef5350', unknown: '#8a8a95' };
const WORD = { live: 'live', degraded: 'degraded', down: 'down', unknown: 'not configured' };

function render(j) {
  const when = j.checkedAt ? new Date(j.checkedAt).toLocaleTimeString() : '';
  const chips = (j.sources || []).map(s =>
    `<span class="bh-chip"><span class="bh-dot" style="background:${DOT[s.status] || DOT.unknown};"></span>${esc(s.name)} · ${esc(WORD[s.status] || s.status)}</span>`
  ).join('');
  const details = (j.sources || []).map(s => {
    const rows = (s.routes || []).map(r =>
      `<div>${esc(r.from)} → ${esc(r.to)} · ${esc(r.asset)} — <span style="color:${DOT[r.status] || DOT.unknown};">${esc(WORD[r.status] || r.status)}</span> (${(r.ms / 1000).toFixed(1)}s)${r.detail ? ` — ${esc(r.detail)}` : ''}</div>`
    ).join('');
    return `<div style="margin-top:6px;"><strong style="font-size:12px;">${esc(s.name)}</strong><div class="bh-routes">${rows}</div></div>`;
  }).join('');
  $('bridgeHealth').innerHTML =
    `<div class="bh-row">${chips}<button class="btn" id="bhRefresh" style="width:auto;padding:6px 12px;font-size:12px;">Re-probe</button></div>
     <div class="status" style="text-align:left;margin-top:6px;">Last probe ${esc(when)} — a live route means deposits open + payout available for that pair.</div>
     ${details}`;
  $('bhRefresh').onclick = () => load(true);
}

async function load(force = false) {
  try {
    const r = await fetch('/api/bridge/health' + (force ? '?refresh=1' : ''));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `API ${r.status}`);
    render(j);
  } catch (e) {
    $('bridgeHealth').innerHTML = `<div class="status error">Bridge health unavailable: ${esc(String(e.message || e).slice(0, 120))}</div>`;
  }
}

load();
setInterval(() => load(false), 60_000);
