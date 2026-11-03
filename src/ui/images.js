// UI images — logo registry + error/success overlays.
//
// New file: ALL image logic lives here. main.js / bridge.js import these
// helpers; index.html holds the .token-logo / .chain-logo / .img-overlay CSS.
// Image files live in public/img/ — Vite copies public/ to dist/ at build.
//
// Sources:
// - Token + chain logos: Trust Wallet assets repo (standard), with
//   DefiLlama chain icons + CoinGecko as fallbacks where Trust Wallet
//   had no file (Ink, Unichain, Avalanche).
// - error.png / swap-success.png: user-supplied images.

export const TOKEN_LOGOS = {
  celo: '/img/logos/celo.png',
  eth: '/img/logos/eth.png',
  usdc: '/img/logos/usdc.png',
  usdt: '/img/logos/usdt.png',
  cusd: '/img/logos/cusd.png',
  dai: '/img/logos/dai.png',
  velo: '/img/logos/velo.png',
  op: '/img/logos/op.png',
  wbtc: '/img/logos/wbtc.png',
  hot: '/img/logos/hot.png',
  '1inch': '/img/logos/1inch.png',
  acx: '/img/logos/acx.png',
};

export const CHAIN_LOGOS = {
  celo: '/img/logos/chain-celo.png',
  optimism: '/img/logos/chain-optimism.png',
  ink: '/img/logos/chain-ink.png',
  base: '/img/logos/chain-base.png',
  unichain: '/img/logos/chain-unichain.png',
  ethereum: '/img/logos/eth.png',
  monad: '/img/logos/chain-monad.png',
  arbitrum: '/img/logos/chain-arbitrum.png',
  avalanche: '/img/logos/chain-avalanche.png',
  bsc: '/img/logos/chain-bsc.png',
};

export const ERROR_IMG = '/img/error.png';
export const SWAP_SUCCESS_IMG = '/img/swap-success.png';
export const SUCCESS_DISPLAY_MS = 7000;
export const TOAD_GANG_IMG = '/img/toad-gang.png';
export const CONNECT_SPLASH_MS = 1200;

export function tokenLogoFor(symbol) {
  if (!symbol) return null;
  return TOKEN_LOGOS[String(symbol).toLowerCase()] || null;
}

export function chainLogoFor(chainKey) {
  if (!chainKey) return null;
  return CHAIN_LOGOS[String(chainKey).toLowerCase()] || null;
}

// Router / aggregator / bridge-source logos. Keyed by the source key used in
// SOURCE_META (swap) and bridge state.source (bridge). oneinch reuses the
// user-supplied 1inch token logo; the rest live in public/img/logos/sources/.
export const SOURCE_LOGOS = {
  aerodrome: '/img/logos/sources/aerodrome.png',
  velodrome: '/img/logos/sources/velodrome.png',
  coinbase: '/img/logos/sources/coinbase.png',
  uniswap: '/img/logos/sources/uniswap.png',
  kyberswap: '/img/logos/sources/kyberswap.png',
  lifi: '/img/logos/sources/lifi.png',
  velora: '/img/logos/sources/velora.png',
  oneinch: '/img/logos/1inch.png',
  oneinchFusion: '/img/logos/1inch.png',
  zerox: '/img/logos/sources/zerox.png',
  zerion: '/img/logos/sources/zerion.png',
  near: '/img/logos/sources/near.png',
  stargate: '/img/logos/sources/stargate.png',
  aori: '/img/logos/sources/aori.png',
};

export function sourceLogoFor(sourceKey) {
  if (!sourceKey) return null;
  return SOURCE_LOGOS[String(sourceKey).toLowerCase()] || null;
}

// Mirror of setTokenLogo for source logos: hides the <img> when the source
// has no logo file yet.
export function setSourceLogo(imgEl, sourceKey) {
  if (!imgEl) return;
  const src = sourceLogoFor(sourceKey);
  if (src) { imgEl.src = src; imgEl.style.display = ''; }
  else { imgEl.removeAttribute('src'); imgEl.style.display = 'none'; }
}

/* ---------------- overlays ---------------- */
// One shared overlay element, created on first use. Click anywhere to
// dismiss. Success auto-hides after SUCCESS_DISPLAY_MS; error stays until
// tapped (or until another overlay replaces it).

let overlayEl = null;
let hideTimer = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'img-overlay';
  overlayEl.style.display = 'none';
  overlayEl.innerHTML = '<img alt=""><div class="hint">tap to dismiss</div>';
  overlayEl.addEventListener('click', hideImageOverlay);
  document.body.appendChild(overlayEl);
  return overlayEl;
}

export function showImageOverlay(src, { autoHideMs = 0 } = {}) {
  const el = ensureOverlay();
  const img = el.querySelector('img');
  img.src = src;
  el.style.display = 'flex';
  clearTimeout(hideTimer);
  hideTimer = null;
  if (autoHideMs > 0) {
    hideTimer = setTimeout(hideImageOverlay, autoHideMs);
  }
}

export function hideImageOverlay() {
  if (overlayEl) overlayEl.style.display = 'none';
  clearTimeout(hideTimer);
  hideTimer = null;
}

/** Error state: user-supplied image. Stays until tapped. */
export function showErrorImage() {
  showImageOverlay(ERROR_IMG);
}

/** Swap completed: user-supplied image, shown for 7 seconds. */
export function showSwapSuccessImage() {
  showImageOverlay(SWAP_SUCCESS_IMG, { autoHideMs: SUCCESS_DISPLAY_MS });
}

/** Connect Wallet hit: Toad Gang splash, shown briefly before the wallet modal opens. */
export function showConnectSplash() {
  showImageOverlay(TOAD_GANG_IMG, { autoHideMs: CONNECT_SPLASH_MS });
}

/* ---------------- logo <img> helpers ---------------- */

/** Set an <img> to a token's logo; hide it when the token has no logo. */
export function setTokenLogo(imgEl, symbol) {
  if (!imgEl) return;
  const src = tokenLogoFor(symbol);
  if (src) {
    imgEl.src = src;
    imgEl.style.display = '';
  } else {
    imgEl.style.display = 'none';
  }
}

/** Set an <img> to a chain's logo; hide it when the chain has no logo. */
export function setChainLogo(imgEl, chainKey) {
  if (!imgEl) return;
  const src = chainLogoFor(chainKey);
  if (src) {
    imgEl.src = src;
    imgEl.style.display = '';
  } else {
    imgEl.style.display = 'none';
  }
}
