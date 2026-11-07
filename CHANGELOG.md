# Changelog: what we changed, and why

One short entry per merged pull request, newest first. Each says **what** changed
and **the logic behind it**. Full detail, tests and caveats are on the linked PR.

## Unreleased: Monad faucet for new Dojo wallets
**What:** a small faucet on Monad mainnet (chain 143). A wallet with no activity there sees "Get 0.05 free
MON for gas" on the Dojo card, so it can enter the Dojo or buy a Dojo Pass. `server/faucet.js`, routes
`/api/faucet/status` and `/api/faucet/claim`. Off until `FAUCET_PRIVATE_KEY` is set.
**Why:** a new user with no MON can't pay the gas to claim their card. A drip of 0.05 MON (about $0.001)
covers both actions with room to spare.
**Safety:** this is the first time the server holds a key, so it is built to lose little: a dedicated wallet
with a few MON, a fixed drip, claims only for wallets that never sent a transaction and hold under 0.02 MON
(one drip per wallet, since spending it needs a transaction), one claim per visitor per day, a daily cap,
sends one at a time, an alert when the wallet runs low or empty, and the key is never returned, logged or
shown. Remove the key or set `FAUCET_DISABLED=1` to switch it off. Tested with fake chain responses (13
tests), read-only against real Monad (your wallet refused, a fresh one eligible, an empty faucet answers
cleanly), and in the real card. No real MON was sent: that needs your funded faucet wallet.

## Unreleased: Dojo card, phase 1 (Dojo Pass and Dojo pet on Monad)
**What:** a "Your Dojo" card at the top of the Bushido tab, read live from three contracts on Monad
mainnet (deployed by `0x00EA…`, no published source):
- **Dojo Pass** `0x2647faf3aaa708d0b9a110744790e1f637fcca53`: `purchasePass()` costs 0.001 MON (to the treasury).
- **Warrior, the Dojo pet** `0xafa3dd46746e39a89d411260d93e7514ab99b96e`: `enterDojo()` registers one warrior per wallet.
- **Bushido Honor** `0x46d5f4924f833cd4054a36eaefa3beca6cd92a7e`: the virtue registry. Not used yet.

The card shows pass status and the pet (level, mood, Vitality and Focus meters, days in the dojo), with
two buttons: "Get your Dojo Pass" and "Enter the Dojo". Both switch the wallet to Monad, dry-run first, then
ask for the signature. No perks yet. Code in `src/dojo/` and `src/DojoCard.jsx`; 13 new tests.
**Why:** the contracts were deployed but invisible in the app. Phase 1 makes them part of the product with
the smallest safe step: show the state, and let a wallet take the two actions. The pass and the warrior are
independent (`enterDojo()` does not check for a pass), so the card shows both side by side.
**Limits:** only the contract owner can change a pet's stats, so the app displays them and cannot grow
them; the stat names (Vitality, Focus) and the mood are our labels, kept in `STAT_LABELS`, since the
contract publishes none. Checked in a real browser against live Monad data (your wallet shows a pass and a
level 1 warrior), a new wallet, and Monad not answering; a real pass purchase or entry was not signed here.

## Unreleased: KyberSwap client ID
**What:** quote and swap-build requests to KyberSwap now send `x-client-id: bushido-dapp`.
**Why:** a real swap on Monad showed KyberSwap tagging the trade `null:bushido-dapp.onrender.com`:
the `null` was the missing app name. With the header, KyberSwap records the trade as coming from
`bushido-dapp`. Checked first that KyberSwap's browser rules allow the header on both requests
(a header they didn't allow would have broken the whole KyberSwap row, as happened with 0x),
then against the real API (the tag appears in the swap data) and in a real browser (no failed
requests, KyberSwap still quotes).

## Verified on-chain (real wallet tests, 7 Nov 2026)
Transactions made from a connected wallet through the app, checked on the block explorers.

| Feature | Evidence |
|---|---|
| **Swap, KyberSwap (Monad)** | 0.0777 USDC to 4.718 WMON, succeeded, 21:28 UTC. `0x38565fcb1913a59dc1d1ae1c6cdb898e8223364a7c7a10775c9639fa05f877bb`. The swap data carries the source tag `bushido-dapp.onrender.com`. |
| **Swap, 1inch (Monad)** | Approve then swap, 2 WMON to USDC, succeeded, 20:32 UTC. `0xcf43098cbf99f5cb160f308807eb23251f9160db59a9fbd0f6a302a4c7067f6e` |
| **Bridge, NEAR Intents, Base to Avalanche** | 0.30 USDC deposit on Base at 20:34:17 UTC (`0x97bcfe73b151b31e42728f8dd49d96c674cc73648ed4b9f515efa59600a37ada`), 0.035812 AVAX delivered on Avalanche at 20:35:00 UTC (`0x2a7c09f619b7b92a953a4d43332b2d8a4a3c2c9753d9120a1e7107a00d22b809`): 43 seconds, matching the quoted rate. |
| **Merkl claim (Monad)** | 7 tokens in one claim, succeeded. `0xce9b3703af85824cb6da9b279637403e9ab8c7c9625d79b9a344b571d29c27e1` |

Not yet tested with a real wallet: a Fusion gasless order, Stargate and Aori bridges, a Base or Ethereum Merkl claim.

## #5: Bridge health monitor (brought up to date and merged)
**What:** a status strip at the top of the Bridge tab: one chip per provider (live, degraded, down,
not configured) with the probed routes, timings and a Re-probe button. The server probes each
provider with a real 1 USDC quote on its test routes (read-only, nothing is ever submitted),
caches the result for 5 minutes, and serves it at `/api/bridge/health`.
**Why:** a bridge can be paused or erroring without any sign until someone tries to use it. A quote
that fails is the earliest signal, so the page shows it before you start. It found Aori's outage
the first time it ran. The PR was written before the Bridge tab was reworked, so it was merged
onto the current layout (the strip sits above the gas card and the route-first form). A provider
that is not set up on this server (1inch Fusion+ needs a vault that only exists on the original
dev machine) now reads "not configured" instead of "down".

## Unreleased: guardrails for keeping every source on
**What:** (1) sources that can't serve the pair (Zerion on Monad, Fusion on a native-coin sale,
Uniswap/Zerion/Coinbase with no wallet connected) are skipped without a call and left out of the
list; (2) quote lookups get their own request limit (400 a minute) apart from the general 90;
(3) quotes appear as each source answers ("3 quoted, 2 still checking") instead of after the
slowest one, and an older slow request can no longer overwrite a newer one; (4) a server
`DISABLED_SOURCES` setting turns any source off with no code change.
**Why:** all sources stay on by default because every one can win on some pair. But one quote
makes up to 10 requests (about 6 through the server), and the old shared limit of 90 a minute
meant about 15 quotes locked a visitor out, after which every source failed. Calls that could
never succeed were still paid for and waited on, the whole list waited for the slowest source
(up to 8 seconds), and a provider outage (like Aori's) had no off-switch. A test that needed
fixing along the way: a failing source is now paused for a minute, so tests reset that state.

## Unreleased: Bridge asks for the route first, then the provider
**What:** on the Bridge tab, From and To come first and list every chain any provider supports;
"Bridge via" moved below them and lists only the providers that can carry that route (NEAR Intents,
Stargate, Aori). If your provider can't do a new route it switches to one that can. A route no
provider supports says so ("No bridge supports Arbitrum to Polygon yet") instead of failing later.
The routing rules live in `src/bridge-route.js` and are tested.
**Why:** the old order made you pick a provider before you knew what you wanted to do, and the
provider then silently limited which chains and tokens you could pick. People think "Base to Monad",
not "Aori". Provider-specific steps (deposit address, Stargate transaction, Aori signed order) are
unchanged. Checked in a browser, including the "Get gas" card; a real bridge was not run here.

## Unreleased: Prettier and `bun run format`
**What:** Prettier, a `.prettierrc.json`, and scripts `format`, `format:check` and `format:all`.
`format` covers the files added in this work; `format:all` formats the whole project.
**Why:** the project had no formatter. Formatting only the new files keeps the diff reviewable;
the rest can be formatted later in one separate commit with `format:all`.

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
Base and Monad. Confirmed with a real signed claim on Monad: tx 0xce9b3703af85824cb6da9b279637403e9ab8c7c9625d79b9a344b571d29c27e1
(7 tokens in one claim, 1,424,523 gas, about 0.145 MON, against roughly $0.03 of rewards).

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
