// Web3 helpers built on AppKit + ethers v6.
// Single place for: account, network, provider/signer, balances, contract calls.

import { ethers } from 'ethers';
import { appKit, appKitNetworkFor, chainKeyForChainId } from '../config.js';
import { getChain } from '../dex/chains.js';
import { ERC20_ABI } from './abis.js';
import { currentChainId } from './network.js';

export function getAccount() {
  const a = appKit.getAccount();
  return a?.isConnected ? a : null;
}

export function isConnected() {
  return !!getAccount();
}

export function getAddress() {
  return getAccount()?.address || null;
}

/** { chainId } of the wallet's current network, or null. (AppKit 1.8 has no getNetwork().) */
export function getNetwork() {
  const chainId = currentChainId(appKit);
  return chainId ? { chainId } : null;
}

export function getChainKey() {
  const net = getNetwork();
  const id = net?.chainId;
  return id ? chainKeyForChainId(id) : null;
}

/**
 * Which of our chains the WALLET is on right now, asked of the wallet itself (eth_chainId).
 * AppKit's own idea of the chain can be stale inside wallet in-app browsers (it kept saying Base while the
 * wallet was on Monad), so anything that must match the wallet should use this. Falls back to AppKit's value.
 */
export async function getWalletChainKey() {
  try {
    const id = Number(await getWalletEthersProvider().send('eth_chainId', []));
    return (Number.isFinite(id) && chainKeyForChainId(id)) || getChainKey();
  } catch {
    return getChainKey();
  }
}

/** Ethers provider for the connected wallet (throws if not connected). */
export function getWalletEthersProvider() {
  const wp = appKit.getWalletProvider();
  if (!wp) throw new Error('Wallet not connected');
  return new ethers.BrowserProvider(wp);
}

export async function getSigner() {
  const p = getWalletEthersProvider();
  return p.getSigner();
}

/** Read-only provider for a chain (no wallet needed), with RPC fallbacks. */
export async function getReadProvider(chainKey) {
  const cfg = getChain(chainKey);
  for (const rpc of cfg.rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(rpc, cfg.chainId, { staticNetwork: true });
      try {
        await Promise.race([p.getBlockNumber(), new Promise((_, r) => setTimeout(() => r(new Error('rpc timeout')), 6000))]);
        return p;
      } catch (e) { p.destroy(); throw e; }
    } catch { /* next RPC */ }
  }
  throw new Error(`No RPC reachable for ${cfg.label}`);
}

/** Switch the wallet to one of our chains (adds the chain if the wallet doesn't know it). */
export async function switchNetwork(chainKey) {
  const net = appKitNetworkFor(chainKey);
  if (!net) throw new Error(`No AppKit network for ${chainKey}`);
  // Without throwOnFailure AppKit swallows a refused switch and the page just stays on the old chain.
  await appKit.switchNetwork(net, { throwOnFailure: true });
}

export async function getNativeBalance(address, chainKey) {
  const p = await getReadProvider(chainKey);
  const bal = await p.getBalance(address);
  return { raw: bal, formatted: ethers.formatEther(bal) };
}

export async function getTokenBalance(tokenAddress, walletAddress, chainKey) {
  const p = await getReadProvider(chainKey);
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, p);
  const [bal, dec] = await Promise.all([c.balanceOf(walletAddress), c.decimals().catch(() => 18)]);
  return { raw: bal, decimals: Number(dec), formatted: ethers.formatUnits(bal, dec) };
}

export async function getAllowance(tokenAddress, owner, spender, chainKey) {
  const p = await getReadProvider(chainKey);
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, p);
  return c.allowance(owner, spender);
}

export async function approveToken(tokenAddress, spender, amountWei) {
  const signer = await getSigner();
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const tx = await c.approve(spender, amountWei);
  return tx.wait();
}

/** Dry-run a transaction via eth_call. Throws with a friendly message if it would revert. */
export async function simulateTx({ to, data, value, from }) {
  const p = getWalletEthersProvider();
  try {
    await p.call({ to, data, value: value ?? 0n, from });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e?.reason || e?.message || 'simulation reverted').slice(0, 160) };
  }
}

export function formatAddress(addr) {
  if (!addr || addr.length < 10) return addr || '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function isValidAddress(addr) {
  return ethers.isAddress(addr);
}

export function subscribeToAccountChanges(cb) {
  return appKit.subscribeAccount(cb);
}

export function subscribeToNetworkChanges(cb) {
  return appKit.subscribeNetwork(cb);
}

export function openConnect() {
  appKit.open({ view: 'Connect' });
}

export function openNetworks() {
  appKit.open({ view: 'Networks' });
}
