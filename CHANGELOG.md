# Changelog: what we changed, and why

One short entry per merged pull request, newest first. Each says **what** changed
and **the logic behind it**. Full detail, tests and caveats are on the linked PR.

## Unreleased: Android app (Trusted Web Activity)
**What:** `Bushido-dApp-android/` (build settings and a step-by-step guide) and a server route,
`/.well-known/assetlinks.json` (`server/assetlinks.js`), that proves to Android the app belongs
to this site. It reads `ANDROID_CERT_SHA256` and optionally `ANDROID_PACKAGE_NAME`.
**Why:** the user wanted an Android app, with social login. Reown's Swift and Android SDKs
have no email or social login, so a native app would lose it. A Trusted Web Activity runs the
web app in Chrome, so social login keeps working and site updates reach the app instantly.
Android only hides the browser bar if the site vouches for the app, hence the route. The
server side is tested; the APK build and a real phone were not.

## Unreleased: "getNetwork is not a function" when swapping with a connected wallet
**What:** the app's `getNetwork()` helper now reads the wallet's chain from AppKit's
`getCaipNetwork()` (`src/utils/network.js`).
**Why:** it called `appKit.getNetwork()`, which does not exist in the installed AppKit
(1.8.24). The swap code asks for the current chain as soon as a wallet is connected, so
every connected swap failed with "getNetwork is not a function". It never showed before
because nothing runs that call until a wallet is connected. A small test now builds a
fake AppKit without `getNetwork` to keep it from coming back. A live wallet swap was not
tested here.

## Unreleased: working Claim button for Merkl rewards
**What:** the Rewards tab's Claim button now works and is always visible. Each chain shows
an active button when something can be claimed, or a disabled one saying why ("Nothing to
claim", or "Not ready yet" with the 8-hour note). Ethereum shows a gas warning for small
amounts. The claim steps are now build, switch chain, simulate, sign, wait
(`src/merkl-claim.js`, `src/merkl-view.js`). Ethereum was added as a wallet network.
**Why:** the old button crashed when clicked: it called `.request()` on the wallet object,
which the app's ethers provider doesn't have. It also had no dry-run before signing (the
Swap tab always has one), hid itself when nothing was ready so it looked missing, and
could not switch wallets to Ethereum, where most of the test wallet's rewards were. The
claim data itself was already right: it dry-ran successfully on real data on Ethereum,
Base and Monad. A real signed claim was not tested here.

## Unreleased: 0x quotes moved to the server
**What:** 0x quotes now go through `/api/zerox/quote` (`server/zerox.js`). The key is read
from `ZEROX_API_KEY`, or the old `VITE_0X_API_KEY` name so an existing setting keeps working.
**Why:** the 0x row always showed "temporarily unavailable" even with a valid key. 0x v2
needs a `0x-version` request header, and 0x's browser (CORS) rules don't allow that header,
so the browser blocked every call before it left the page. A server call works, and the key
no longer has to sit in the public web page. Checked against real 0x on Base and Monad.

## Unreleased: "Buffer is not defined" when connecting a wallet
**What:** a browser `Buffer` polyfill (`src/shims/buffer-global.js`, using the
`buffer` package) loaded first in `src/main.js`.
**Why:** Reown AppKit's sign-in code and an Ethereum helper library call Node's
`Buffer` directly. Browsers don't have it, so connecting crashed with "Buffer is
not defined". Providing it globally fixes the cause instead of patching each
caller. Checked in a real browser that `Buffer` exists and encodes correctly;
a full wallet sign-in was not tested here.

## Unreleased: welcome line in the wallet sign-in message
**What:** the sign-in prompt now reads "Welcome bushido warriors. Enjoy exploring
the bushido beta dex." between the address and the URI (`BushidoAuthentication`
in `src/config.js`).
**Why:** the sign-in prompt is the first thing a new user sees from the app, and
it was a bare technical block. The text goes in the standard SIWE "statement"
slot, so it is part of what the wallet signs. AppKit offers no option for it, so
a small subclass sets it. The message format was checked offline; a live
sign-in was not tested.

## #12: CHANGELOG and PR template
**What:** this file, plus a pull request template with a Why section.
**Why:** the reasoning behind each change lived only in chat; it now sits next to
the code, and every new PR is asked for its "why" up front.

## #11: Swap screen redesign; install banner removed
**What:** matching tab icons, one scrolling row of chain pills, big "You pay / You
receive" cards, a route card showing the best source and "+x% vs next" with a
*compare* link, slippage buttons above the Swap button, safety checks, sources
folded away. The "Add to Home Screen" banner is gone.
**Why:** the old screen pushed slippage to the bottom, spent half the page on
source chips, and used 10px labels. People care about one answer first (the best
price), so that comes first and the detail is one tap away. Slippage sits next to
the button because it affects the trade you are about to sign. The install banner
only took up space; installing still works from the browser menu (Chrome on
Android may show its own prompt).

## #10: 1inch Fusion, Bushido panels, retry/pause, icons, MIT license
**What:** gasless swaps through 1inch Fusion; a Virtue Compass, gated swap panel
and Operations log in the Bushido tab (high-severity errors emailed via Resend);
failing quote sources are retried once, then paused (1m, 2m, 5m, 15m, 30m);
the torii app icons with metadata; the MIT license.
**Why:** Fusion lets the user swap without holding gas, and the server relay keeps
the 1inch key off the phone. The swap panel refuses any trade whose dry-run
simulation fails or whose slippage is outside 0.1%–1%, because a blocked trade
costs nothing and a bad one can. Retrying once then pausing keeps a broken
service (Aori was returning 500s) from slowing every quote, without hammering
it. Signing and sending are never retried, since a retry could double-spend.

## #9: Social logins, 1inch Business host, Fusion SDK, router labels
**What:** Google, X, Discord, Farcaster, Apple, GitHub and Facebook sign-in;
1inch calls move to `api.1inch.com`; the Fusion SDK is added; router comments
corrected (the `0x1111…2A65` address is V6, not V5).
**Why:** social login lets people without a wallet in hand try the app. 1inch's
current docs use the `.com` host, so we follow them. The SDK was added ahead of
the Fusion work. Wrong labels mislead anyone auditing the code.

## #8: Reown Authentication (SIWX)
**What:** after connecting, the wallet signs a one-time message and Reown keeps
the session.
**Why:** proves the person controls the address they connected with, without
spending gas.

## #7: Swap fixes, ⛽ Get gas over HOT Protocol, Vercel support
**What:** KyberSwap and Velora transaction builders fixed; dead RPCs replaced;
a "Get gas" card on the Bridge tab (pay USDC, receive native gas, $0.28
minimum, many HOT Protocol chains); the server can run on Vercel.
**Why:** simulating every source on-chain showed the default (KyberSwap) was
building transactions to no address, so the default swap always failed. Get gas
solves the new-chain problem: you cannot move anything on a chain where you hold
no gas. It reuses the existing bridge form, so no new money-moving code was added.

## #6: Bushido-dApp (UX fixes, installable app, rename)
**What:** the main button moved under "To" and became "Connect wallet" when
disconnected; honest labels ("API key not set", not "no liquidity"); one button
style with readable contrast; 44px tap targets; installable PWA that never caches
prices; renamed from "Multi-Chain DEX".
**Why:** a design critique found the button was below the first screen, the
contrast was too low to read, and labels blamed liquidity for missing keys. The
app caches only its own files so quotes are always live.

## #4: Merkl Rewards (views + claiming)
**What:** a Rewards tab listing opportunities and the wallet's claimable rewards,
with a Claim button.
**Why:** keyless and non-custodial: the server only prepares the transaction and
the user signs. The exact claim pipeline was dry-run on-chain before opening.

## #3: Test suite and CI
**What:** 11 tests; CI now runs on pull requests, not only on release.
**Why:** the old workflow ran `npm test` with no test script, so it always
failed. Tests that fail on the old code (Uniswap slippage, Zerion parsing) now
guard those fixes.

## #2: Intel and Bushido tabs, Aave-style wallet modal, Zerion parsing fix
**What:** DEX Intelligence (sample data, labelled), the Bushido dashboard wired to
the connected wallet, themed wallet modal, Zerion quotes parsed correctly.
**Why:** the Bushido signal never received price history, so it always said
"Waiting for setup". Zerion quotes were being thrown away as `[object Object]`.

## #1: Uniswap slippage fix, env-based keys, deploy guide, Monad default
**What:** Uniswap slippage sent as a percent; Uniswap and 1inch keys read from
environment variables; `TRUST_PROXY`; `DEPLOY.md`; the app opens on Monad.
**Why:** Uniswap was receiving `50` as a *percent*, so every swap allowed 50%
slippage and was open to sandwich attacks. Keys previously came only from a
vault that exists on one dev machine. Behind a proxy, rate limiting saw one IP
for everyone without `TRUST_PROXY`.
