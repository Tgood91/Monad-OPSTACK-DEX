// Route-first bridging: the user picks From and To first, and the provider follows.
// Pure helpers (no DOM, no wallet) so the rules can be unit-tested.

// Relay sits before Aori: Aori's quote service has been returning errors, so it is the last resort.
export const PROVIDER_ORDER = ['near', 'stargate', 'relay', 'aori'];
export const PROVIDER_LABELS = { near: 'NEAR Intents', stargate: 'Stargate', relay: 'Relay', aori: 'Aori' };

const uniq = (list) => [...new Set(list)];

/** Chains the user can pay FROM with any provider. */
export function fromChainsAll(sourceChains) {
  return uniq(PROVIDER_ORDER.flatMap((s) => sourceChains[s] || []));
}

/** Chains the user can send TO: everything payable, plus receive-only chains NEAR delivers to. */
export function toChainsAll(sourceChains, nearToOnly) {
  return uniq([...fromChainsAll(sourceChains), ...nearToOnly]);
}

/** Chains a single provider can deliver to. */
export function toChainsFor(source, sourceChains, nearToOnly) {
  return source === 'near' ? [...sourceChains.near, ...nearToOnly] : sourceChains[source] || [];
}

/** Providers that can carry from -> to, in preference order. */
export function providersFor(from, to, sourceChains, nearToOnly) {
  if (!from || !to || from === to) return [];
  return PROVIDER_ORDER.filter(
    (s) => (sourceChains[s] || []).includes(from) && toChainsFor(s, sourceChains, nearToOnly).includes(to),
  );
}

/** Keep the current provider if it still works for the route, else the first that does. */
export function pickProvider(current, available) {
  if (!available.length) return null;
  return available.includes(current) ? current : available[0];
}
