// Dojo Pass perks, browser side. One plain signature (no transaction, no gas) proves you own a pass wallet;
// the server checks the pass on Monad and returns a 7-day token. The token is kept in this browser and
// sent as a header on our own /api calls, which is what raises the quote allowance (server/perks.js).

export const TOKEN_KEY = 'bushido.perks.token';

/** Must match server/perks.js exactly: the wallet signs this text and the server rebuilds it to verify. */
export const perksMessage = (address, issuedAt) =>
  `Bushido Dojo Pass perks\nI hold a Dojo Pass and want its perks on this site.\nWallet: ${address}\nIssued: ${issuedAt}\nThis signs a message only. It sends no transaction and costs no gas.`;

export function loadPerk(address, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  try {
    const r = JSON.parse(storage.getItem(TOKEN_KEY));
    if (r && r.token && r.exp > now && String(r.address).toLowerCase() === String(address || '').toLowerCase()) return r;
  } catch {
    /* no stored token */
  }
  return null;
}
export function savePerk(rec, storage = globalThis.localStorage) {
  try {
    storage.setItem(TOKEN_KEY, JSON.stringify(rec));
  } catch {
    /* blocked storage: the perk just won't be remembered */
  }
}
export function clearPerk(storage = globalThis.localStorage) {
  try {
    storage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Ask the wallet to sign, send it to the server, keep the token. `signMessage` is the wallet's own. */
export async function unlockPerks(address, { signMessage, fetchImpl = fetch, now = () => Date.now(), storage } = {}) {
  const issuedAt = new Date(now()).toISOString();
  const signature = await signMessage(perksMessage(address, issuedAt));
  const r = await fetchImpl('/api/perks/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, issuedAt, signature }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Perks were refused (${r.status})`);
  const rec = { token: j.token, address: j.address, exp: j.exp, multiplier: j.multiplier };
  savePerk(rec, storage);
  return rec;
}

/** Add the token to our own same-origin /api requests (and nothing else). */
export function installPerkHeader({ win = globalThis, storage = globalThis.localStorage } = {}) {
  const orig = win.fetch?.bind(win);
  if (!orig || win.__perkHeader) return;
  win.__perkHeader = true;
  win.fetch = (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.startsWith('/api/')) {
        const rec = JSON.parse(storage.getItem(TOKEN_KEY) || 'null');
        if (rec?.token && rec.exp > Date.now()) {
          const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
          headers.set('x-perk-token', rec.token);
          init = { ...init, headers };
        }
      }
    } catch {
      /* never let perks break a request */
    }
    return orig(input, init);
  };
}
