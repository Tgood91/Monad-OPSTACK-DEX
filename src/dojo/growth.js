// Pet growth + daily check-in. Everything here is app-side: the live Warrior contract only lets its owner
// change stats, so growth is COMPUTED from numbers the contract already holds (level, days in the dojo) plus a
// check-in streak kept on this device. Nothing is written on-chain. Pure functions, unit-tested.

export const STAGES = [
  { id: 'deshi', name: 'Deshi', kanji: '弟子', blurb: 'A new disciple, learning the way.', min: 0 },
  { id: 'samurai', name: 'Samurai', kanji: '侍', blurb: 'Trained and steady.', min: 7 },
  { id: 'ronin', name: 'Rōnin', kanji: '浪人', blurb: 'Walks alone, seasoned by the road.', min: 21 },
  { id: 'sensei', name: 'Sensei', kanji: '先生', blurb: 'Others learn from this warrior.', min: 60 },
  { id: 'meijin', name: 'Meijin', kanji: '名人', blurb: 'A master of the art.', min: 150 },
];

/** Growth score: days in the dojo + 10 per level above 1 + the check-in streak. */
export const growthScore = ({ days = 0, level = 1, streak = 0 }) =>
  Math.max(0, days) + Math.max(0, level - 1) * 10 + Math.max(0, streak);

export function growthStage(input) {
  const score = growthScore(input);
  let i = 0;
  STAGES.forEach((s, k) => {
    if (score >= s.min) i = k;
  });
  const cur = STAGES[i];
  const next = STAGES[i + 1] || null;
  return {
    ...cur,
    index: i,
    score,
    next: next ? { name: next.name, at: next.min, left: next.min - score } : null,
    pct: next ? Math.round(((score - cur.min) / (next.min - cur.min)) * 100) : 100,
  };
}

// ---- Daily check-in (a "bow"): free, no transaction, once per local day ----
const dayKey = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dayNumber = (key) => Math.round(Date.parse(key + 'T00:00:00Z') / 86_400_000);

export const emptyCheckin = () => ({ last: null, streak: 0, best: 0, total: 0 });

/** Has this record already bowed today? */
export const bowedToday = (rec, now = new Date()) => !!rec && rec.last === dayKey(now);

/** The streak still counts if you bowed today or yesterday; after a missed day it shows 0. */
export function liveStreak(rec, now = new Date()) {
  if (!rec?.last) return 0;
  const gap = dayNumber(dayKey(now)) - dayNumber(rec.last);
  return gap <= 1 ? rec.streak : 0;
}

/** Record today's bow. Same day: unchanged. Next day: +1. Missed a day: back to 1. */
export function bow(rec = emptyCheckin(), now = new Date()) {
  const today = dayKey(now);
  if (rec.last === today) return rec;
  const gap = rec.last ? dayNumber(today) - dayNumber(rec.last) : null;
  const streak = gap === 1 ? rec.streak + 1 : 1;
  return { last: today, streak, best: Math.max(rec.best || 0, streak), total: (rec.total || 0) + 1 };
}

const KEY = (addr) => `bushido.dojo.bow.${String(addr).toLowerCase()}`;
export function loadBow(addr, storage = globalThis.localStorage) {
  try {
    const r = JSON.parse(storage.getItem(KEY(addr)));
    return r && typeof r.streak === 'number' ? r : emptyCheckin();
  } catch {
    return emptyCheckin();
  }
}
export function saveBow(addr, rec, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY(addr), JSON.stringify(rec));
  } catch {
    /* private window or blocked storage: the bow just won't be remembered */
  }
}

// ---- Gas nudge (Monad-first): a swap or dojo action needs a little MON ----
export const LOW_GAS_WEI = 20_000_000_000_000_000n; // 0.02 MON
export const isLowGas = (wei) => BigInt(wei) < LOW_GAS_WEI;
