// Browser glue for 1inch Fusion: connects the user's wallet to fusion-core and
// runs one gasless swap. Loaded on demand from src/main.js (dynamic import), so
// neither this file nor the Fusion SDK is in the main bundle.

import { getSigner, getReadProvider } from '../utils/web3.js';
import { placeFusionOrder, waitForFusionFill, walletConnector } from './fusion-core.js';

/**
 * Sign and submit a Fusion order, then wait for it to fill.
 * `q` is the selected Fusion quote (see the Fusion adapter); `onStage` is called with
 *   ('sign') while the wallet is asked to sign, then ('wait', status, seconds) on every poll.
 * Resolves with { orderHash, txHash }; throws with a user-readable message otherwise.
 */
export async function runFusionSwap({ chainKey, chainId, q, wallet, slippageBps, onStage }) {
  const [signer, provider] = await Promise.all([getSigner(), getReadProvider(chainKey)]);
  onStage('sign');
  // The order is built from a fresh quote: refuse if it is now worse than the
  // guaranteed minimum the user was shown, by more than their slippage setting.
  const minAcceptable = (q.minAmountOut * BigInt(10000 - slippageBps)) / 10000n;
  const { sdk, orderHash } = await placeFusionOrder({
    chainId,
    origin: window.location.origin,
    connector: walletConnector({ signer, provider }),
    tokenIn: q.tokenIn,
    tokenOut: q.tokenOut,
    amountInWei: q.amountInWei,
    wallet,
    slippageBps,
    minAcceptable,
  });
  onStage('wait', 'pending', 0);
  const fill = await waitForFusionFill({ sdk, orderHash, onStatus: (status, sec) => onStage('wait', status, sec) });
  return { orderHash, txHash: fill.fills?.[0]?.txHash };
}
