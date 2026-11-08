// Mounts the faucet pond into #faucetPondRoot (top of the Rewards tab) and keeps its `trader` prop in sync with
// the connected wallet. Rendered lazily the first time the Rewards tab opens. The component is NOT re-keyed per
// wallet: a "Connect & claim" tap has to survive the wallet connecting.
import React from 'react';
import { createRoot } from 'react-dom/client';
import FaucetPond from './FaucetPond.jsx';
import { appKit } from './config.js';

let root = null;

function render() {
  const a = appKit.getAccount();
  const trader = a?.isConnected ? a.address : null;
  if (!root) root = createRoot(document.getElementById('faucetPondRoot'));
  root.render(<FaucetPond trader={trader} />);
}

export function showFaucetPond() {
  render();
}

appKit.subscribeAccount(() => {
  if (root) render();
});
