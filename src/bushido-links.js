// Links shown on the Bushido tab (pure helpers, unit-tested).

/** The Bushido code, as two public repos whose names contain "virtuals". */
export const BUSHIDO_REPOS = [
  { name: 'bushido-virtuals', url: 'https://github.com/Tgood91/bushido-virtuals' },
  { name: 'bushido-virtuals0', url: 'https://github.com/Tgood91/bushido-virtuals0' },
];

const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Explorer link for a transaction, only for a well-formed hash on a chain that has an explorer. */
export function txUrl(chain, hash) {
  if (!chain?.explorer || !HASH.test(String(hash || ''))) return null;
  return `${String(chain.explorer).replace(/\/+$/, '')}/tx/${hash}`;
}
