# Bushido-dApp: the mobile app

Bushido-dApp is the installable mobile version of the DEX. It is a
**Progressive Web App (PWA)**:
- People add it to their home screen from the browser. There's no app store.
- It opens full-screen with its own icon.
- It updates as soon as the site is deployed.

The app screens (Swap, Bridge, Intel, Bushido, Rewards) are the **same code
as the website** in `../src`, so every fix reaches both. This folder holds
only what makes it an installable phone app.

## Install it on a phone

The site must be served over **HTTPS**, which any real deployment is.

| Phone | Steps |
|---|---|
| **Android** (Chrome, Edge, Samsung Internet) | Open the site and tap **Install** on the Bushido-dApp banner, or use the menu ⋮ → *Install app*. |
| **iPhone / iPad** (Safari) | Open the site, tap **Share** → **Add to Home Screen**. The banner shows this hint. |

Wallets connect the same way as on the website (WalletConnect / the wallet
modal). The app never holds keys or funds.

## What's in this folder

| File | What it does |
|---|---|
| `manifest.webmanifest` | App name (**Bushido-dApp**), icons, full-screen mode, colours, and the Swap/Bridge home-screen shortcuts |
| `sw.js` | Service worker: loads the app when offline, keeps the build files cached. **Never caches `/api`, prices, RPC or wallet traffic**, so quotes are always live. |
| `pwa.js` | Registers the service worker and opens the right tab for home-screen shortcuts (there is no in-page install banner; install from the browser menu, and Chrome on Android may show its own prompt automatically) |
| `pwa.css` | Phone-only styles: notch / home-indicator safe areas when installed, safe-area padding |
| `backdrop.jpg` | The Bushido art (frog samurai, Fuji, the eight virtue stones) behind the app (Android app only, via `.android-app` in `pwa.css`) |
| `icons/` | Home-screen icons: 192 and 512 px, a maskable 512 for Android shapes, and the 180 px Apple touch icon |
| `vite-plugin.js` | Publishes these files with every build: `sw.js` at the site root (so it controls the whole app), and the manifest and icons under `/Bushido-dApp/` |

## Android app mode

When the site runs in the Android app (or the installed PWA on Android), `src/android-app.js` switches on app
behaviour: the Back button closes an open sheet, then returns to Swap, before it leaves the app; short vibrations on a
confirmed swap or bridge; and the `.android-app` styles in `pwa.css` (backdrop, no pull-to-refresh). On the website
nothing changes.

## How it plugs in

- `vite.config.js` adds `bushidoDapp()` to the build.
- `index.html` links the manifest, icons and `pwa.js`.

Nothing else is needed. `npm run build` produces the website and the app
together, and every host in `DEPLOY.md` (Node, Vercel, Replit) serves them.

## Updating the app

Deploy as usual. Installed apps pick up the new version the next time
they're opened online:
- Pages are fetched from the network first.
- Build files have new hashed names on every build.

If you change `sw.js` itself, bump `VERSION` in it so old caches are cleared.

## Offline behaviour

With no connection the app still opens, and the quote box says
*"You're offline"*. It never shows old prices. Quotes refresh automatically
when the connection returns.
