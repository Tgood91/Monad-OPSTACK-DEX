// Which chain id is the wallet on? Pure helper (no imports) so it can be unit-tested.
// AppKit 1.8 has no `getNetwork()`; the current network is `getCaipNetwork()`
// (its `id` is the numeric chain id) or `getChainId()`.
export function currentChainId(kit) {
  const n = kit?.getCaipNetwork?.();
  const id = n?.id ?? kit?.getChainId?.();
  const num = Number(id);
  return Number.isFinite(num) && num > 0 ? num : null;
}
