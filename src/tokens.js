/**
 * Token picker — frontend module
 * Fetches tokens from /api/tokens, renders a searchable picker modal,
 * and fires a callback with the selected token.
 *
 * Usage:
 *   import { openTokenPicker } from './tokens.js';
 *   const tok = await openTokenPicker(chainId);
 *   // tok: { symbol, name, address, decimals, logoURI, ... }  or null if dismissed
 */

const API = '/api/tokens';

// ── Cache ─────────────────────────────────────────────────────────────────────
const _cache = new Map(); // `${chainId}:${q}` → Token[]

async function fetchTokens(chainId, q = '', limit = 50) {
  const key = `${chainId}:${q}:${limit}`;
  if (_cache.has(key)) return _cache.get(key);
  const url = `${API}?chainId=${chainId}&q=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`token API ${res.status}`);
  const data = await res.json();
  _cache.set(key, data);
  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function logoEl(tok) {
  if (!tok.logoURI) return `<span class="tp-logo-fallback">${tok.symbol[0]}</span>`;
  return `<img class="tp-logo" src="${tok.logoURI}" alt=""
           onerror="this.style.display='none';this.nextElementSibling.style.display=''">
          <span class="tp-logo-fallback" style="display:none">${tok.symbol[0]}</span>`;
}

// ── Styles (injected once) ────────────────────────────────────────────────────
const CSS = `
.tp-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9000;display:flex;align-items:center;justify-content:center}
.tp-modal{background:#0f1117;border:1px solid #2a2d36;border-radius:12px;width:min(420px,96vw);max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
.tp-header{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 12px;border-bottom:1px solid #1e2130}
.tp-header h3{margin:0;font-size:14px;font-weight:600;color:#e2e8f0;letter-spacing:.05em;text-transform:uppercase}
.tp-close{background:none;border:none;color:#64748b;font-size:18px;cursor:pointer;padding:4px 6px;border-radius:4px;line-height:1}
.tp-close:hover{background:#1e2130;color:#e2e8f0}
.tp-search{padding:10px 12px;border-bottom:1px solid #1e2130}
.tp-search input{width:100%;background:#1a1d26;border:1px solid #2a2d36;border-radius:8px;color:#e2e8f0;padding:8px 12px;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box}
.tp-search input:focus{border-color:#c8362a}
.tp-list{overflow-y:auto;flex:1;padding:4px 0}
.tp-row{display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;transition:background .12s}
.tp-row:hover{background:#1a1d26}
.tp-logo{width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0}
.tp-logo-fallback{width:28px;height:28px;border-radius:50%;background:#1e2130;color:#94a3b8;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.tp-info{flex:1;min-width:0}
.tp-sym{font-size:14px;font-weight:600;color:#e2e8f0}
.tp-name{font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-addr{font-size:10px;color:#334155;font-family:monospace}
.tp-empty{padding:32px;text-align:center;color:#334155;font-size:13px}
.tp-loading{padding:24px;text-align:center;color:#334155;font-size:13px}
`;

let _styleInjected = false;
function injectStyles() {
  if (_styleInjected) return;
  const el = document.createElement('style');
  el.textContent = CSS;
  document.head.appendChild(el);
  _styleInjected = true;
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Open the token picker modal.
 * @param {number} chainId
 * @param {{ title?: string }} [opts]
 * @returns {Promise<object|null>}
 */
export function openTokenPicker(chainId, { title = 'Select Token' } = {}) {
  injectStyles();

  return new Promise((resolve) => {
    // Backdrop + modal
    const backdrop = document.createElement('div');
    backdrop.className = 'tp-backdrop';
    backdrop.innerHTML = `
      <div class="tp-modal" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="tp-header">
          <h3>${title}</h3>
          <button class="tp-close" aria-label="Close">✕</button>
        </div>
        <div class="tp-search">
          <input type="text" placeholder="Search by symbol or name…" autocomplete="off" spellcheck="false">
        </div>
        <div class="tp-list"><div class="tp-loading">Loading…</div></div>
      </div>`;
    document.body.appendChild(backdrop);

    const input = backdrop.querySelector('input');
    const list  = backdrop.querySelector('.tp-list');
    const btn   = backdrop.querySelector('.tp-close');

    function close(tok = null) {
      backdrop.remove();
      resolve(tok);
    }

    // Click outside to dismiss
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    btn.addEventListener('click', () => close());
    // ESC
    function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } }
    document.addEventListener('keydown', onKey);

    function renderRows(tokens) {
      if (!tokens.length) {
        list.innerHTML = '<div class="tp-empty">No tokens found</div>';
        return;
      }
      list.innerHTML = tokens.map(tok => `
        <div class="tp-row" data-addr="${tok.address}">
          ${logoEl(tok)}
          <div class="tp-info">
            <div class="tp-sym">${tok.symbol}</div>
            <div class="tp-name">${tok.name}</div>
            <div class="tp-addr">${tok.address.slice(0,10)}…${tok.address.slice(-6)}</div>
          </div>
        </div>`).join('');
      list.querySelectorAll('.tp-row').forEach((row, i) => {
        row.addEventListener('click', () => close(tokens[i]));
      });
    }

    // Debounced search
    let _t;
    async function doSearch(q) {
      list.innerHTML = '<div class="tp-loading">Searching…</div>';
      try {
        const tokens = await fetchTokens(chainId, q);
        renderRows(tokens);
      } catch {
        list.innerHTML = '<div class="tp-empty">Failed to load tokens</div>';
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => doSearch(input.value.trim()), 220);
    });

    // Initial load
    doSearch('');
    input.focus();
  });
}

/**
 * Quick lookup: resolve an address to its token metadata on a chain.
 * Returns null if the address is not in the registry.
 * @param {number} chainId
 * @param {string} address
 * @returns {Promise<object|null>}
 */
export async function resolveToken(chainId, address) {
  try {
    const r = await fetch(`${API}/address?chainId=${chainId}&address=${address}`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
