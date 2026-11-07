// Bushido-dApp: the installable-app layer on top of the DEX web app.
// - registers the service worker (production builds only; it would fight Vite's dev reload)
// (no in-page install banner: installing is still available from the browser menu)
// - opens the right tab for home-screen shortcuts (#swap, #bridge)

import './pwa.css';

// ---- service worker ----
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[Bushido-dApp] SW registration failed:', e));
  });
}

// ---- home-screen shortcuts: /#swap, /#bridge ----
const TAB_FOR_HASH = { '#swap': 'tabSwap', '#bridge': 'tabBridge' };
function openFromHash() {
  const id = TAB_FOR_HASH[location.hash];
  if (id) document.getElementById(id)?.click();
}
window.addEventListener('load', openFromHash);
window.addEventListener('hashchange', openFromHash);
