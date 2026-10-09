// Web3 helpers built on AppKit + ethers v6.
// Single place for: account, network, provider/signer, balances, contract calls.

import { ethers } from 'ethers';
import { appKit, appKitNetworkFor, chainKeyForChainId } from '../config.js';
import { getChain } from '../dex/chains.js';
import { ERC20_ABI } from './abis.js';

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

export function getNetwork() {
  return appKit.getNetwork();
}

export function getChainKey() {
  const net = getNetwork();
  const id = net?.chainId;
  return id ? chainKeyForChainId(id) : null;
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
      const p = new ethers.JsonRpcProvider(rpc);
      await Promise.race([p.getBlockNumber(), new Promise((_, r) => setTimeout(() => r(new Error('rpc timeout')), 6000))]);
      return p;
    } catch { /* next RPC */ }
  }
  throw new Error(`No RPC reachable for ${cfg.label}`);
}

/** Switch the wallet to one of our chains (adds the chain if the wallet doesn't know it). */
export async function switchNetwork(chainKey) {
  const net = appKitNetworkFor(chainKey);
  if (!net) throw new Error(`No AppKit network for ${chainKey}`);
  await appKit.switchNetwork(net);
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
