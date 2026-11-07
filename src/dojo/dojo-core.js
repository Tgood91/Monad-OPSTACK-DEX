// Dojo: the three contracts on Monad mainnet (deployed by 0x00EA…, see CHANGELOG), read-only helpers.
// No wallet and no library needed here: plain JSON-RPC reads plus small decoders, all unit-tested.
//
//   Dojo Pass  purchasePass() payable (fee, default 0.001 MON, forwarded to the treasury).
//              Holding a pass is a yes/no flag per wallet.
//   Warrior    enterDojo() registers ONE warrior per wallet (no pass needed). It stores a birth time,
//              a last-interaction time and four numbers that start at 1, 72, 50 and 0.
//              Only the contract owner can change a stat, so the app shows it, it does not grow it.
//   Honor      the virtue registry (HONOR badges). Not used in Phase 1.
//
// The contracts have no published source, so the stat names below are OUR labels for the numbers
// (kept in STAT_LABELS so they are easy to change), not names read from the contract.

export const DOJO = {
  chainId: 143,
  rpcs: ['https://rpc.monad.xyz', 'https://monad-mainnet.drpc.org'],
  pass: '0x2647faf3aaa708d0b9a110744790e1f637fcca53',
  warrior: '0xafa3dd46746e39a89d411260d93e7514ab99b96e',
  honor: '0x46d5f4924f833cd4054a36eaefa3beca6cd92a7e',
};

// Function selectors. purchasePass / enterDojo / warriors are keccak names (checked in tests);
// passHolder and passFee are the contract's own public getters (name not published).
export const SEL = {
  purchasePass: '0x121d52ea',
  enterDojo: '0x365020fe',
  warriors: '0x3d40327c',
  passHolder: '0x89f5ffc7',
  passFee: '0x7fbab58a',
};

export const STAT_LABELS = { vitality: 'Vitality', focus: 'Focus' };

const word = (hex, i) => BigInt('0x' + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
const padAddr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

/** warriors(address) -> { birth, last, level, vitality, focus, streak, registered } */
export function decodeWarrior(hex) {
  if (typeof hex !== 'string' || hex.length < 2 + 7 * 64) throw new Error('bad warrior data');
  const n = (i) => Number(word(hex, i));
  return {
    birth: n(0),
    last: n(1),
    level: n(2),
    vitality: n(3),
    focus: n(4),
    streak: n(5),
    registered: word(hex, 6) === 1n,
  };
}

export const decodeBool = (hex) => typeof hex === 'string' && hex.length >= 66 && word(hex, 0) !== 0n;
export const decodeUint = (hex) => (typeof hex === 'string' && hex.length >= 66 ? word(hex, 0) : 0n);

/** How the pet feels, from its Vitality meter (an app-side label: nothing is written on-chain). */
export function petMood(vitality) {
  if (vitality >= 80) return 'Radiant';
  if (vitality >= 60) return 'Ready';
  if (vitality >= 40) return 'Steady';
  return 'Weary';
}

export const daysSince = (ts, nowSec) => Math.max(0, Math.floor((nowSec - ts) / 86400));

export function fmtMon(wei) {
  const v = Number(wei) / 1e18;
  return v === 0 ? '0' : v < 0.0001 ? '<0.0001' : String(parseFloat(v.toFixed(4)));
}

/**
 * What the card shows. `data` is { hasPass, fee, warrior|null } once loaded.
 * The pass and the warrior are independent: a wallet can have either, both or neither.
 */
export function dojoView({ connected, loading, error, data, nowSec = Math.floor(Date.now() / 1000) }) {
  if (!connected) return { kind: 'connect', message: 'Connect a wallet to see your Dojo.' };
  if (loading) return { kind: 'loading', message: 'Reading your Dojo from Monad…' };
  if (error) return { kind: 'error', message: error };
  const w = data.warrior;
  return {
    kind: 'ready',
    pass: data.hasPass
      ? { has: true, badge: 'Dojo Pass ✓' }
      : {
          has: false,
          badge: 'No Dojo Pass',
          action: { id: 'pass', label: `Get your Dojo Pass · ${fmtMon(data.fee)} MON` },
        },
    pet:
      w && w.registered
        ? {
            registered: true,
            level: w.level,
            mood: petMood(w.vitality),
            days: daysSince(w.birth, nowSec),
            idleDays: daysSince(w.last, nowSec),
            meters: [
              { label: STAT_LABELS.vitality, value: w.vitality, pct: Math.min(100, w.vitality) },
              { label: STAT_LABELS.focus, value: w.focus, pct: Math.min(100, w.focus) },
            ],
          }
        : { registered: false, action: { id: 'enter', label: 'Enter the Dojo' } },
  };
}

/** eth_call with fallback across RPCs. `fetchImpl` is injectable for tests. */
export async function ethCall(to, data, { fetchImpl = fetch, rpcs = DOJO.rpcs } = {}) {
  let last;
  for (const url of rpcs) {
    try {
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`Monad is not answering (${String(last?.message || last).slice(0, 60)})`);
}

/** Read everything the card needs for one wallet. */
export async function loadDojo(address, opts = {}) {
  const [holder, fee, warrior] = await Promise.all([
    ethCall(DOJO.pass, SEL.passHolder + padAddr(address), opts),
    ethCall(DOJO.pass, SEL.passFee, opts),
    ethCall(DOJO.warrior, SEL.warriors + padAddr(address), opts),
  ]);
  return { hasPass: decodeBool(holder), fee: decodeUint(fee), warrior: decodeWarrior(warrior) };
}

/** Transaction for a card button. The pass sends its fee as the value. */
export function dojoTx(actionId, fee) {
  if (actionId === 'pass') return { to: DOJO.pass, data: SEL.purchasePass, value: fee };
  if (actionId === 'enter') return { to: DOJO.warrior, data: SEL.enterDojo, value: 0n };
  throw new Error('unknown action');
}
