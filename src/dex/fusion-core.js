// 1inch Fusion (gasless swaps) on top of the official @1inch/fusion-sdk.
//
// The user signs an order (EIP-712) instead of sending a transaction; 1inch
// resolvers compete to fill it and pay the gas. Funds only move when an order
// is filled, so an unfilled order costs the user nothing.
//
// All HTTP goes through our own relay (/api/fusion, server/fusion-relay.js),
// which adds the 1inch API key server-side. This module has no wallet or DOM
// dependencies (wallet access is passed in), so it also runs under Node tests.
// Loaded lazily (dynamic import) so the SDK stays out of the main bundle.

import { FusionSDK, OrderStatus, getLimitOrderContract } from '@1inch/fusion-sdk';

export const FUSION_SOURCE = 'bushido-dapp';
export const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const QUOTE_PLACEHOLDER_WALLET = '0x0000000000000000000000000000000000000001';

// Statuses after which an order can no longer be filled.
const DEAD = new Set([
  OrderStatus.Expired,
  OrderStatus.Cancelled,
  OrderStatus.FalsePredicate,
  OrderStatus.NotEnoughBalanceOrAllowance,
  OrderStatus.WrongPermit,
  OrderStatus.InvalidSignature,
]);

/** fetch-based HTTP provider for the SDK. Errors carry the relay's message. */
export function relayHttp(fetchImpl = (...a) => globalThis.fetch(...a)) {
  const run = async (url, init) => {
    const r = await fetchImpl(url, init);
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(body?.error || body?.description || body?.message || `fusion ${r.status}`);
    return body;
  };
  return {
    get: (url) => run(url, { headers: { Accept: 'application/json' } }),
    post: (url, data) =>
      run(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
      }),
  };
}

/**
 * Wallet connector for the SDK: signs with an ethers v6 signer, and reads
 * contracts through an ethers provider.
 */
export function walletConnector({ signer, provider }) {
  return {
    async signTypedData(walletAddress, typedData) {
      const from = await signer.getAddress();
      if (from.toLowerCase() !== String(walletAddress).toLowerCase()) {
        throw new Error('Connected wallet changed. Reconnect and try again.');
      }
      // ethers derives EIP712Domain itself; passing it in `types` is an error.
      const { EIP712Domain, ...types } = typedData.types;
      return signer.signTypedData(typedData.domain, types, typedData.message);
    },
    ethCall(to, data) {
      return provider.call({ to, data });
    },
  };
}

export function createSdk({ chainId, origin = '', connector, fetchImpl }) {
  return new FusionSDK({
    url: `${origin}/api/fusion`,
    network: chainId,
    blockchainProvider: connector,
    httpProvider: relayHttp(fetchImpl),
  });
}

const addrIn = (t) => t.address;
const addrOut = (t) => (t.isNative ? NATIVE_SENTINEL : t.address);

/** The 1inch limit-order contract the user must approve to sell an ERC-20. */
export function fusionSpender(chainId) {
  return getLimitOrderContract(chainId);
}

/** Quote: expected output, guaranteed minimum, and the approval spender. */
export async function fusionQuote({
  chainId,
  origin,
  tokenIn,
  tokenOut,
  amountInWei,
  wallet,
  slippageBps = 50,
  fetchImpl,
}) {
  // Fusion orders are made from an ERC-20 allowance; the chain's native coin has none.
  if (tokenIn.isNative) throw new Error('Fusion sells tokens, not the native coin');
  const sdk = createSdk({ chainId, origin, fetchImpl });
  const quote = await sdk.getQuote({
    fromTokenAddress: addrIn(tokenIn),
    toTokenAddress: addrOut(tokenOut),
    amount: amountInWei.toString(),
    walletAddress: wallet || QUOTE_PLACEHOLDER_WALLET,
    source: FUSION_SOURCE,
    slippage: slippageBps / 100, // percent
  });
  const preset = quote.presets[quote.recommendedPreset];
  return {
    amountOut: BigInt(quote.toTokenAmount),
    minAmountOut: preset.auctionEndAmount, // what resolvers must at least deliver
    quoteId: quote.quoteId,
    preset: quote.recommendedPreset,
    spender: fusionSpender(chainId),
  };
}

/**
 * Build, sign (in the user's wallet) and submit an order. `minAcceptable` is the
 * least the user will accept; the order is built from a fresh quote, so if the
 * price moved against them we refuse before they are asked to sign.
 */
export async function placeFusionOrder({
  chainId,
  origin,
  connector,
  tokenIn,
  tokenOut,
  amountInWei,
  wallet,
  slippageBps = 50,
  minAcceptable,
  fetchImpl,
}) {
  const sdk = createSdk({ chainId, origin, connector, fetchImpl });
  const prepared = await sdk.createOrder({
    fromTokenAddress: addrIn(tokenIn),
    toTokenAddress: addrOut(tokenOut),
    amount: amountInWei.toString(),
    walletAddress: wallet,
    source: FUSION_SOURCE,
    slippage: slippageBps / 100,
  });
  if (minAcceptable != null && prepared.order.takingAmount < BigInt(minAcceptable)) {
    throw new Error('The price moved against you since the quote. Refresh and try again.');
  }
  const info = await sdk.submitOrder(prepared.order, prepared.quoteId);
  return { sdk, orderHash: info.orderHash, takingAmount: prepared.order.takingAmount };
}

/**
 * Poll until the order is filled (returns the status) or can no longer be
 * filled (throws). `onStatus(status, elapsedSec)` is called on every poll.
 */
export async function waitForFusionFill({
  sdk,
  orderHash,
  onStatus,
  signal,
  intervalMs = 2500,
  timeoutMs = 10 * 60 * 1000,
}) {
  const t0 = Date.now();
  for (;;) {
    if (signal?.aborted) throw new Error('Stopped waiting. The order may still fill; check your wallet.');
    const s = await sdk.getOrderStatus(orderHash);
    onStatus?.(s.status, Math.round((Date.now() - t0) / 1000), s);
    if (s.status === OrderStatus.Filled) return s;
    if (DEAD.has(s.status)) throw new Error(failMessage(s.status));
    if (Date.now() - t0 > timeoutMs)
      throw new Error('Still waiting after 10 minutes. The order may still fill; check your wallet.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function failMessage(status) {
  switch (status) {
    case OrderStatus.Expired:
      return 'No resolver filled the order in time. Nothing was spent. Try again, or pick another source.';
    case OrderStatus.Cancelled:
      return 'The order was cancelled. Nothing was spent.';
    case OrderStatus.NotEnoughBalanceOrAllowance:
      return 'Your balance or approval dropped below the order amount. Nothing was spent.';
    default:
      return `The order can't be filled (${status}). Nothing was spent.`;
  }
}

/** Turn a relay/SDK error into a short label for the quote list. */
export function explainFusionError(e) {
  const m = String(e?.message || e);
  if (/not set|rejected the API key|401|403/i.test(m)) return 'API key not set';
  return m.slice(0, 80);
}
