// Base Builder Code attribution (ERC-8021).
// Spec: https://docs.base.org/specifications/builder-codes/for-app-developers
// The suffix is appended to the calldata of transactions this app sends ON BASE, so Base can attribute them to the
// project (Bushido-gang-dex). Contracts ignore trailing calldata, so the call itself is unchanged.
// This app sends through ethers, not a viem wallet client, so the suffix is added by hand with `withBuilderCode`.
import { Attribution } from 'ox/erc8021';

export const BUILDER_CODE = 'bc_zjp6vs17';
export const DATA_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });
export const BASE_CHAIN_ID = 8453;

/** True when calldata already ends with this app's suffix. */
export function hasBuilderCode(data) {
  return typeof data === 'string' && data.toLowerCase().endsWith(DATA_SUFFIX.slice(2).toLowerCase());
}

/**
 * Return a copy of `tx` with the Builder Code suffix on its calldata when the transaction is for Base.
 * Any other chain, or a transaction already carrying the suffix, is returned unchanged.
 * Apply it BEFORE the dry-run, so what is simulated is exactly what the wallet signs.
 */
export function withBuilderCode(tx, chainId) {
  if (Number(chainId) !== BASE_CHAIN_ID || !tx) return tx;
  const data = tx.data && tx.data !== '0x' ? tx.data : '0x';
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data) || hasBuilderCode(data)) return tx;
  return { ...tx, data: data + DATA_SUFFIX.slice(2) };
}
