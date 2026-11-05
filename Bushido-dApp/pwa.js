// Bushido-dApp: the installable-app layer on top of the DEX web app.
// - registers the service worker (production builds only; it would fight Vite's dev reload)
// - shows an "Install app" prompt: a real Install button where the browser
//   supports it (Android / Chrome / Edge), Add-to-Home-Screen steps on iPhone
// - opens the right tab for home-screen shortcuts (#swap, #bridge)

import './pwa.css';

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac

const DISMISS_KEY = 'bushido-dapp-install-dismissed';
function dismissed() { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } }
function remember() { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ } }

// ---- service worker ----
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[Bushido-dApp] SW registration failed:', e));
  });
}

// ---- install prompt ----
const bar = document.getElementById('pwaInstall');
let deferred = null; // the browser's install event, kept until the user taps Install

function show(text, withButton) {
  if (!bar || isStandalone() || dismissed()) return;
  bar.querySelector('.txt span').textContent = text;
  bar.querySelector('.go').style.display = withButton ? '' : 'none';
  bar.classList.add('show');
}
function hide() { bar?.classList.remove('show'); }

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // keep the mini-infobar from popping up; use our own prompt
  deferred = e;
  show('Install for full-screen swaps from your home screen.', true);
});

bar?.querySelector('.go').addEventListener('click', async () => {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice.catch(() => null);
  deferred = null;
  hide();
});
bar?.querySelector('.x').addEventListener('click', () => { remember(); hide(); });
window.addEventListener('appinstalled', hide);

// iPhone/iPad Safari has no install event: show the manual steps instead.
if (isIOS() && !isStandalone()) {
  show('Tap Share, then "Add to Home Screen".', false);
}

// ---- home-screen shortcuts: /#swap, /#bridge ----
const TAB_FOR_HASH = { '#swap': 'tabSwap', '#bridge': 'tabBridge' };
function openFromHash() {
  const id = TAB_FOR_HASH[location.hash];
  if (id) document.getElementById(id)?.click();
}
window.addEventListener('load', openFromHash);
window.addEventListener('hashchange', openFromHash);
