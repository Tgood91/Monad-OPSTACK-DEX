// Mounts the React Bushido dashboard into #bushidoRoot and keeps its `trader`
// prop in sync with the connected wallet. Rendered lazily on first tab open.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './bushido.css';
import BushidoTradingDashboard from './BushidoTradingDashboard.jsx';
import { appKit } from './config.js';

let root = null;
let lastTrader;

function currentTrader() {
  const a = appKit.getAccount();
  return a?.isConnected ? a.address : null;
}

function render() {
  const trader = currentTrader();
  if (root && trader === lastTrader) return;
  lastTrader = trader;
  if (!root) root = createRoot(document.getElementById('bushidoRoot'));
  // key=trader remounts the component so its loading state resets per wallet
  root.render(<BushidoTradingDashboard key={trader || 'none'} trader={trader} />);
}

export function showBushido() {
  render();
}

appKit.subscribeAccount(() => { if (root) render(); });
