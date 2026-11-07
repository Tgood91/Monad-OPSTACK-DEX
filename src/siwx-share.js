// One wallet signature should cover every EVM chain. AppKit's default only accepts a sign-in made on the
// SAME chain you are on, so each chain switch asked for a new signature, and declining it bounced you back
// to the last signed chain (the "stuck on Base" symptom). A signed message proves you own the ADDRESS, and an
// address is the same on every EVM chain, so any eip155 chain can reuse it.

export const SESSION_CACHE_MS = 60_000;

const lower = (s) => String(s || '').toLowerCase();
export const isEvm = (caipNetworkId) => String(caipNetworkId || '').startsWith('eip155:');

/** Does the server's record of the signed-in account cover this chain + address? */
export function coversChain(account, chainId, address) {
  if (!account?.address || lower(account.address) !== lower(address)) return false;
  if (isEvm(chainId) && isEvm(account.caip2Network)) return true; // same address, any EVM chain
  return account.caip2Network === chainId; // non-EVM: keep the strict rule
}

/** Remember a good answer for a minute so quick chain switches don't re-ask the server each time. */
export function createSessionCache(ttlMs = SESSION_CACHE_MS) {
  let hit = null;
  return {
    get(address, now = Date.now()) {
      return hit && hit.address === lower(address) && now - hit.at < ttlMs ? hit.account : null;
    },
    set(address, account, now = Date.now()) {
      hit = { address: lower(address), account, at: now };
    },
    clear() {
      hit = null;
    },
  };
}
