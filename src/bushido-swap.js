// Chain handling for the Bushido tab's gated swap panel (pure helpers, unit-tested).
// The panel used to be hard-wired to ETH -> USDC on Base, which pulled the wallet back to Base every time.
import { CHAINS } from './dex/chains.js';

export const FALLBACK_CHAIN = 'monad';

/** Native coin -> USDC on the chosen chain, the sources to ask, and the words to show. */
export function swapSetup(chainKey) {
  const chain = CHAINS[chainKey];
  if (!chain) throw new Error(`unknown chain ${chainKey}`);
  const tIn = chain.tokens.find((t) => t.isNative);
  const tOut = chain.tokens.find((t) => t.symbol === 'USDC');
  if (!tIn || !tOut) throw new Error(`${chain.label} has no native coin / USDC pair`);
  return {
    chain,
    tIn,
    tOut,
    // Fusion signs an order instead of sending a transaction, so it can't be dry-run first.
    sources: chain.sources.filter((s) => s !== 'fusion'),
    title: `Swap ${chain.native} → USDC on ${chain.label}`,
    amountLabel: `${chain.native} amount`,
    defaultAmount: chainKey === 'monad' ? '1' : '0.001',
  };
}

/** Follow the wallet if it is on a chain the app supports, otherwise start on Monad. */
export function pickChain(walletChainKey, supported = Object.keys(CHAINS)) {
  return walletChainKey && supported.includes(walletChainKey) ? walletChainKey : FALLBACK_CHAIN;
}

/**
 * Put the wallet on `chainKey`, and CONFIRM it moved. `switchNetwork` throws if the wallet refuses;
 * if it returns but the wallet never reports the new chain, say so instead of carrying on silently.
 */
export async function switchAndConfirm({
  chainKey,
  label,
  getChainKey,
  switchNetwork,
  tries = 20,
  ms = 400,
  sleep = (t) => new Promise((r) => setTimeout(r, t)),
}) {
  if ((await getChainKey()) === chainKey) return; // getChainKey may be sync or async
  await switchNetwork(chainKey);
  for (let i = 0; i < tries; i++) {
    if ((await getChainKey()) === chainKey) return;
    await sleep(ms);
  }
  throw new Error(`Your wallet did not switch to ${label}. Switch it in your wallet app and try again.`);
}
