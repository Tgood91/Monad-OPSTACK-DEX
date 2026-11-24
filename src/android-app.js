// Android app mode: what changes when the site runs inside the Bushido-dApp Android app
// (Tgood91/Bushido-dApp-android, a Trusted Web Activity opening /?source=pwa) or the installed PWA on Android.
// Nothing here runs on the plain website: every export is a no-op until initAndroidApp() detects app mode.
//
// - The system Back button steps back through the app (close an open sheet, then return to Swap) instead of
//   leaving it. Tab switches and sheets add history entries only in app mode; on the website they do not.
// - Short vibrations on a confirmed swap or bridge.
// - The `android-app` class on <html>, which Bushido-dApp/pwa.css uses for app-only styles.

const FLAG = 'bushido-android-app';

/**
 * Is this the Android app? Android only, and one of: the app's start URL (?source=pwa), opened by the Android app
 * (an android-app:// referrer), the installed PWA (display-mode standalone), or already detected in this tab
 * (remembered for the session, so a reload or an in-app link without ?source=pwa stays in app mode).
 */
export function detectAndroidApp({
  userAgent = '',
  search = '',
  referrer = '',
  standalone = false,
  remembered = false,
} = {}) {
  if (!/\bAndroid\b/i.test(userAgent)) return false;
  if (remembered || standalone) return true;
  if (new URLSearchParams(search).get('source') === 'pwa') return true;
  return referrer.startsWith('android-app://');
}

/**
 * A stack of things the Back button closes, newest first. Each layer adds one history entry; Back (popstate)
 * closes the top layer. Closing a layer from the page (its × or a pick) removes its entry with history.back(),
 * and the popstate that causes is skipped so it does not close a second layer.
 */
export function createBackStack(win) {
  const layers = [];
  let skip = 0;
  win.addEventListener('popstate', () => {
    if (skip > 0) {
      skip--;
      return;
    }
    const top = layers.pop();
    if (top) top.close();
  });
  return {
    /** Adds a layer; returns release(), to call when the page closes it itself. */
    push(close) {
      const layer = { close };
      layers.push(layer);
      win.history.pushState({ bushidoLayer: layers.length }, '');
      return () => {
        const i = layers.indexOf(layer);
        if (i < 0) return; // already closed by Back
        layers.splice(i, 1);
        skip++;
        win.history.back();
      };
    },
    get depth() {
      return layers.length;
    },
  };
}

let stack = null;
let vibrate = null;

/** Detects app mode and switches the Android behaviour on. Returns whether it is app mode. */
export function initAndroidApp(win = globalThis.window) {
  if (!win || stack) return !!stack;
  let remembered = false;
  try {
    remembered = win.sessionStorage.getItem(FLAG) === '1';
  } catch {}
  const on = detectAndroidApp({
    userAgent: win.navigator?.userAgent,
    search: win.location?.search,
    referrer: win.document?.referrer,
    standalone: !!win.matchMedia?.('(display-mode: standalone)').matches,
    remembered,
  });
  if (!on) return false;
  try {
    win.sessionStorage.setItem(FLAG, '1');
  } catch {}
  win.document?.documentElement.classList.add('android-app');
  stack = createBackStack(win);
  if (typeof win.navigator?.vibrate === 'function') vibrate = (p) => win.navigator.vibrate(p);
  return true;
}

export const isAndroidApp = () => !!stack;

/** Lets Back close something (a sheet, a tab). Returns release() for when the page closes it; a no-op off-app. */
export function backLayer(close) {
  return stack ? stack.push(close) : () => {};
}

const PATTERNS = { tick: 12, success: [18, 60, 18], error: [40, 40, 40] };

/** A short vibration in the app; nothing on the website or without vibration support. */
export function haptic(kind = 'tick') {
  try {
    vibrate?.(PATTERNS[kind] ?? PATTERNS.tick);
  } catch {}
}

/** For tests: forget app mode. */
export function resetAndroidApp() {
  stack = null;
  vibrate = null;
}
