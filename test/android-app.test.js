import test from "node:test";
import assert from "node:assert/strict";
import {
  detectAndroidApp,
  createBackStack,
  initAndroidApp,
  isAndroidApp,
  backLayer,
  haptic,
  resetAndroidApp,
} from "../src/android-app.js";

const ANDROID = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

test("app mode is Android plus a sign of the app", () => {
  assert.equal(detectAndroidApp({ userAgent: ANDROID, search: "?source=pwa" }), true);
  assert.equal(
    detectAndroidApp({ userAgent: ANDROID, referrer: "android-app://io.github.tgood91.bushidodapp/" }),
    true,
  );
  assert.equal(detectAndroidApp({ userAgent: ANDROID, standalone: true }), true);
  assert.equal(detectAndroidApp({ userAgent: ANDROID, remembered: true }), true);
  // the plain website on an Android phone, and the app's URL on an iPhone, stay the website
  assert.equal(detectAndroidApp({ userAgent: ANDROID, search: "?source=web", referrer: "https://google.com/" }), false);
  assert.equal(detectAndroidApp({ userAgent: IPHONE, search: "?source=pwa", standalone: true }), false);
  assert.equal(detectAndroidApp(), false);
});

// A window whose history behaves like a browser's: back() fires popstate (asynchronously, as browsers do).
function fakeWindow({ ua = ANDROID, search = "?source=pwa" } = {}) {
  const listeners = {};
  const entries = [{}];
  const store = {};
  const classes = new Set();
  const vibrations = [];
  const win = {
    navigator: { userAgent: ua, vibrate: (p) => vibrations.push(p) },
    location: { search },
    document: { referrer: "", documentElement: { classList: { add: (c) => classes.add(c) } } },
    matchMedia: () => ({ matches: false }),
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) },
    addEventListener: (t, f) => (listeners[t] ||= []).push(f),
    history: {
      pushState: (s) => entries.push(s),
      back: () => {
        entries.pop();
        queueMicrotask(() => (listeners.popstate || []).forEach((f) => f({})));
      },
    },
    pressBack() {
      this.history.back();
    },
    entries,
    store,
    classes,
    vibrations,
  };
  return win;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("Back closes the newest layer first, one per press", async () => {
  const win = fakeWindow();
  const s = createBackStack(win);
  const closed = [];
  s.push(() => closed.push("tab"));
  s.push(() => closed.push("sheet"));
  assert.equal(win.entries.length, 3);
  win.pressBack();
  await tick();
  assert.deepEqual(closed, ["sheet"]);
  win.pressBack();
  await tick();
  assert.deepEqual(closed, ["sheet", "tab"]);
  assert.equal(s.depth, 0);
});

test("closing a layer from the page removes its history entry without closing another layer", async () => {
  const win = fakeWindow();
  const s = createBackStack(win);
  const closed = [];
  s.push(() => closed.push("tab"));
  const release = s.push(() => closed.push("sheet"));
  release(); // the user tapped × on the sheet
  await tick();
  assert.deepEqual(closed, [], "the popstate from removing the entry is skipped");
  assert.equal(win.entries.length, 2);
  release(); // a second release is harmless
  await tick();
  assert.equal(win.entries.length, 2);
  win.pressBack();
  await tick();
  assert.deepEqual(closed, ["tab"], "the next Back still returns from the tab");
});

test("off the app everything is inert", () => {
  resetAndroidApp();
  const win = fakeWindow({ search: "" });
  assert.equal(initAndroidApp(win), false);
  assert.equal(isAndroidApp(), false);
  backLayer(() => {})();
  haptic("success");
  assert.equal(win.entries.length, 1);
  assert.deepEqual(win.vibrations, []);
  assert.equal(win.classes.size, 0);
});

test("in the app: class, remembered for the session, back layers and haptics", () => {
  resetAndroidApp();
  const win = fakeWindow();
  assert.equal(initAndroidApp(win), true);
  assert.ok(win.classes.has("android-app"));
  assert.equal(win.store["bushido-android-app"], "1");
  backLayer(() => {});
  assert.equal(win.entries.length, 2);
  haptic("success");
  assert.deepEqual(win.vibrations, [[18, 60, 18]]);
  // a reload or link without ?source=pwa: the session flag keeps app mode on
  resetAndroidApp();
  const later = fakeWindow({ search: "" });
  later.store["bushido-android-app"] = "1";
  assert.equal(initAndroidApp(later), true);
  resetAndroidApp();
});
