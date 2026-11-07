import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGES,
  growthScore,
  growthStage,
  bow,
  bowedToday,
  liveStreak,
  emptyCheckin,
  loadBow,
  saveBow,
  isLowGas,
} from "../src/dojo/growth.js";

const d = (s) => new Date(s + "T12:00:00");

test("score = days + 10 per level above 1 + streak", () => {
  assert.equal(growthScore({ days: 5, level: 3, streak: 2 }), 27);
  assert.equal(growthScore({}), 0);
});
test("stages rise at 0 / 7 / 21 / 60 / 150 and top out", () => {
  assert.equal(growthStage({ days: 0 }).name, "Deshi");
  assert.equal(growthStage({ days: 7 }).name, "Samurai");
  assert.equal(growthStage({ days: 21 }).name, "Rōnin");
  assert.equal(growthStage({ days: 60 }).name, "Sensei");
  const top = growthStage({ days: 500 });
  assert.equal(top.name, "Meijin");
  assert.equal(top.next, null);
  assert.equal(top.pct, 100);
  assert.equal(STAGES.length, 5);
});
test("progress to the next stage", () => {
  const s = growthStage({ days: 3 });
  assert.equal(s.next.name, "Samurai");
  assert.equal(s.next.left, 4);
});
test("bowing: first, same day, next day, missed day", () => {
  let r = bow(emptyCheckin(), d("2026-11-01"));
  assert.deepEqual([r.streak, r.total], [1, 1]);
  assert.equal(bow(r, d("2026-11-01")), r); // same day: unchanged
  r = bow(r, d("2026-11-02"));
  assert.equal(r.streak, 2);
  r = bow(r, d("2026-11-03"));
  assert.deepEqual([r.streak, r.best], [3, 3]);
  r = bow(r, d("2026-11-06")); // missed days
  assert.deepEqual([r.streak, r.best, r.total], [1, 3, 4]);
});
test("month and year boundaries still count as consecutive", () => {
  let r = bow(emptyCheckin(), d("2026-12-31"));
  r = bow(r, d("2027-01-01"));
  assert.equal(r.streak, 2);
});
test("liveStreak shows 0 after a missed day, and bowedToday works", () => {
  const r = bow(emptyCheckin(), d("2026-11-01"));
  assert.equal(bowedToday(r, d("2026-11-01")), true);
  assert.equal(bowedToday(r, d("2026-11-02")), false);
  assert.equal(liveStreak(r, d("2026-11-02")), 1);
  assert.equal(liveStreak(r, d("2026-11-04")), 0);
});
test("storage round-trip, per wallet, and survives broken storage", () => {
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  saveBow("0xABC", bow(emptyCheckin(), d("2026-11-01")), st);
  assert.equal(loadBow("0xabc", st).streak, 1);
  assert.equal(loadBow("0xdef", st).streak, 0);
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(loadBow("0xabc", broken).streak, 0);
  assert.doesNotThrow(() => saveBow("0xabc", emptyCheckin(), broken));
});
test("low gas threshold is 0.02 MON", () => {
  assert.equal(isLowGas(10_000_000_000_000_000n), true);
  assert.equal(isLowGas(20_000_000_000_000_000n), false);
});
