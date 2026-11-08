# Changelog: what we changed, and why

One short entry per merged pull request, newest first. Each says **what** changed
and **the logic behind it**. Full detail, tests and caveats are on the linked PR.

## Unreleased: Dojo Pass perks, verified
**What:** a wallet that holds a Dojo Pass can unlock a 3× quote allowance (the cap on how many price lookups it can make per minute). One free signature (no transaction, no gas) lasts 7 days. The card shows the button, then "Pass perks are on until …".
**Why:** perks need the server to *trust* that a visitor holds a pass, and a wallet address alone proves nothing. So the wallet signs a short plain message, the server checks the signer and asks Monad itself whether that wallet holds a pass, then issues a signed token the limiter honours. The message is time-stamped (5 minutes) so it can't be replayed, the token can't be forged or edited, and it only raises a request limit: it never touches funds. Set `PERKS_SECRET` in Render so tokens survive restarts (without it, holders re-sign after a restart); `PERK_QUOTE_MULTIPLIER` changes the 3×.

## Unreleased: the chain pills become one menu button
**What:** the row of seven chain pills on the Swap tab, and the one in the Bushido swap panel, is now a single button showing the current chain (with its colour dot and a hamburger icon). Tapping it opens a "Choose network" list with every chain and the active one outlined. Picking one switches chains exactly as the pills did.
**Why:** with BNB Chain and Avalanche added there were seven pills, which already scrolled sideways on a phone. One button keeps the screen calm and gives the list room to grow. It reuses the same slide-up sheet as the coin and bridge dropdowns, so it behaves the same everywhere and works in wallet browsers that never show native pickers. Checked in a phone-sized browser: the menu lists all seven, the pair follows the pick (BNB → USDC, AVAX → USDC), Escape closes it, and in the Bushido panel picking Avalanche made the wallet switch networks (so the wallet library accepts the new chains).
**Open, not fixed:** there is an unexplained ~96px gap between the Connect row and the tab bar on a phone, on the live site too. I could not find its source in the page's own spacing, so it is left for a closer look.

## Unreleased: swaps on BNB Chain and Avalanche
**What:** the Swap tab and the Bushido swap panel now work on BNB Chain and Avalanche (7 chains in all). BNB Chain: BNB, USDC, USDT, BTCB, ETH, CAKE. Avalanche: AVAX, USDC, USDt, BTC.b, WETH.e. Quotes come from LI.FI, KyberSwap, Velora, 1inch and 0x. The wallet can switch to either chain, and the Bushido panel opens each with a small first amount (0.01 BNB, 0.1 AVAX).
**Why:** the bridges already move money to BNB Chain and Avalanche (Stargate, Aori, NEAR), so people arrive there with funds and nothing to do with them in the app. Nothing was added from memory: each chain's RPCs were tried, every token was read on its own chain (symbol, decimals) and priced through KyberSwap at about $20 and $200 (keeping under 0.5% and 0.25% loss; JOE on Avalanche missed that and was left out), and each source was run through the app's own quote code against the live server: all five quoted within about 0.3% of each other (0.03 BNB → about 20.9 USDC; 2.5 AVAX → about 20.4 USDC). BNB's USDC and USDT have **18 decimals**, the same trap that broke Stargate from BNB, so a test pins it. Zerion refused the test request and Uniswap's code excludes these chains, so both stay off there until verified; Fusion is not offered (it can't sell the native coin). New test: `test/chains-table.test.js` checks every chain's data (valid addresses, decimals, RPC count, sources). It also found that Ink has only one RPC, a gap that is not fixed here.
**Not yet verified:** a real swap transaction on either chain (needs a wallet with BNB or AVAX), and the BscScan and Snowtrace links, which block automated requests, as MonadVision does.

## Unreleased: fix the Stargate token table (9 of 15 entries were wrong)
**What:** corrected the hand-copied Stargate token table in `server/stargate.js`. Eight token addresses were typo'd, truncated (39 hex characters instead of 40, one 42) or wrongly cased, so they failed the address checksum, and BNB Chain's USDC and USDT were given 6 decimals when they have 18. Every address now matches what its own Stargate pool reports on-chain (`pool.token()`), BNB stablecoins are 18 decimals, and a new test (`test/stargate-table.test.js`) fails if any address stops being valid or BNB's decimals change.
**Why:** Stargate looked "down" from several chains. It wasn't: the quote calls use the pool addresses (all correct), but the browser uses the token address for balances and approvals, and ethers rejects a bad address. So bridging from Optimism, Arbitrum, Avalanche, Ethereum-USDT and BNB broke at that step, while Base and Ethereum USDC (which happened to be right) worked, which is why the health strip, which only probes Base routes, stayed green. BNB also sent amounts 12 orders of magnitude too small. Tested all 75 chain/token routes through the server: 51 quoted before, 59 now.
**Not fixed, not ours:** 16 USDT routes (all touching Optimism or Arbitrum) still revert inside Stargate's own contracts with custom errors, and two Ethereum USDT routes failed because our server's Ethereum RPC answered with a gateway error (HTTP 525) on that run. Neither is a table problem. Aori's quote service has been returning 500 errors and is genuinely down. The health strip should also probe an Optimism or Arbitrum route, not only Base ones, so this kind of break shows up.

## Unreleased: the koi pond is the faucet's claim button (Rewards tab)
**What:** at the top of the Rewards tab, the garden pond itself is a button for the free starter MON. Not connected: it reads "Connect & claim 0.1 MON free", opens the wallet connect, and when the wallet connects it checks eligibility and claims by itself. A coin drops into the pond while it works; ripples spread and the label turns green ("✓ 0.1 MON sent", with a link to the transaction) when the MON lands. It hides itself for wallets that already have gas (unless tapped, then it says why), and is absent if the faucet is off. The label is frosted glass (a translucent version of the Connect gradient with a soft blur and a light edge) so the pond shows through while the text stays readable. It is a real button: keyboard-reachable, announced to screen readers, and the animation stops for people who prefer reduced motion.
**Why:** the faucet offer used to live only inside the Dojo card, after you had connected, so the people who most need free gas had to find the Bushido tab and connect first. The pond makes claiming a single tap. Safeguards: it only claims after you tap (a tap stays armed for 2 minutes, so an unrelated later connect never sends anything), it never claims for a wallet the server says doesn't need it, errors are amber and retryable, and the claim still goes through the server's own rules (one per wallet, one per visitor per day, daily cap). Checked in a browser with a stand-in wallet and a faked faucet server: one claim request, for the connected wallet, then the sent state. A header button was tried first and replaced by this.

## Unreleased: the health page shows how the server sees each visitor's address
**What:** `/api/health` now includes a `proxy` section: the `TRUST_PROXY` setting in effect, the address the server uses for you (`yourIp`), the forwarded-address chain it received, and whether a CDN is in front.
**Why:** per-visitor limits (request limits and the faucet's one-claim-per-visitor-per-day) depend on `TRUST_PROXY` being the right number for the host. Render sits behind Cloudflare, so there may be two hops, and a wrong number fails silently: too low lumps many visitors under one Cloudflare address; too high lets a visitor fake theirs. Checked with a simulated visitor-plus-CDN chain: 1 reports the CDN's address, 2 reports the visitor's. This lets us read the right answer from the live site instead of guessing. It only reports the caller's own request data back to them.

## Unreleased: correct the README and code comments about the Dojo contracts' source
**What:** the README and a comment in `src/dojo/dojo-core.js` said the Dojo contracts' source was unpublished. It is public: all three are verified on Sourcify ("perfect" match). The docs now name each contract (`BushidoDojoGate`, `BushidoProtocol`, `BushidoVirtueRegistry`), say what each really stores and who can change it, and show where to read the source.
**Why:** the claim came from Monadscan, which does not list the contracts as verified, and was repeated without asking Sourcify. A wrong statement about what a contract can do is worse than none. Reading the source also showed that the Warrior's two meters are called `honor` and `reputation` on-chain, not "Vitality" and "Focus" as the card labels them, and that only `honor` can change (owner only). The labels are flagged in the docs; renaming them is left as a separate change. Docs and comments only: no behaviour changed.

## Unreleased: README rewritten to match what is built
**What:** the README now covers everything in the app: the five tabs, the 20 Monad coins and how they were chosen, the swap and bridge flows, the "review before you pay" deposit screen, the Dojo (pass, warrior, garden, ranks, bow, verified pass perks, faucet), the safety model, every environment variable, deploying, testing, the API and the project layout.
**Why:** the old README predated most of this work. It said 10 quote sources, listed the wrong chains, described the Bushido swap panel as Base-only, and did not mention the Dojo, the faucet, perks, the coin picker or the bridge health strip. A README that is wrong is worse than a short one. It also records one correction found while writing it: `/healthz` only returns the front page; the real status endpoint is `/api/health`.

## Unreleased: swap hash is a real link, and the Bushido tab links to the Bushido code
**What:** after a swap on the Bushido tab, the transaction hash is now a clickable link to that transaction on the chain's explorer (Monadscan on Monad). The swap panel also shows "Bushido code on GitHub" with links to the two public repos whose names contain "virtuals": `bushido-virtuals` and `bushido-virtuals0`.
**Why:** the swap result was plain text ("Swapped ✓ via kyberswap — 0xfbc92f8e…"), so there was nothing to tap to see the transaction, and nothing on the page pointed to the code behind the Bushido virtues. A link is only made for a well-formed 66-character hash on a chain that has an explorer; otherwise the hash stays plain text.

## Unreleased: "Simulation failed: Call failed" no longer blocks swaps the chain would accept
**What:** the dry-run check before a swap now asks our public Monad RPC first and the wallet second. A real on-chain revert still blocks the swap, with its reason. If the wallet's connection just refuses the check (a bare "Call failed"), the public RPC answers instead. If nobody can answer, nothing is sent and the message says "Couldn't check this right now", not that the swap would fail. A wallet that can't cover the amount now says "Not enough in this wallet to cover this amount plus gas". The Operations log only records "high" for a genuine revert; everything else is a warning.
**Why:** some wallet browsers refuse `eth_call` through the wallet and answer "Call failed". That is the wallet declining to answer, not the swap failing, but it was reported as "Simulation failed" and logged as high severity (it filled the Operations log with false alarms). Same root cause as the missing balances: reads should not depend on the wallet. Not yet seen working in a real wallet browser.

## Unreleased: Monad is the default network
**What:** the wallet library's default network is now Monad (it was Base), and Monad is first in the network list.
**Why:** on connect the library moves the wallet to its default network. With Base as the default, a wallet that was already on Monad got pulled to Base the moment it connected, which fought the rest of the app (it starts on Monad). Checked with a stand-in wallet: starting on Monad it stays on Monad, and starting on Base it is moved to Monad. Wallets on other chains are still moved on connect, just to Monad now, and you can switch to any chain from the pills as before.

## Unreleased: more Monad tokens in the picker
**What:** the Monad coin list goes from 2 to 20: MON and USDC as before, plus WMON (wrapped MON), plus USDT0, WETH, WBTC, AUSD, sMON (Kintsu staked MON), gMON, shMON (ShMonad), and from Monad's official token list GHO, cbBTC, LBTC, Cake, avUSD, mUSD, XAUt0 (Tether Gold), aprMON (aPriori staked MON) and syrupUSDC (Maple), and MONAZ (MonazolaM, the owner's own Clanker token; its pool is small, about $2k, so keep swaps small).
**Why:** these are the coins people actually hold on Monad, and the new picker made a longer list usable. Nothing was added from memory alone: each contract was read on Monad itself (name, symbol and decimals all matched) and each got a live KyberSwap route from MON (1000 MON, about $16.60, priced into every one with no visible price loss). MON and USDC stay first so existing defaults and the Bushido panel don't change. Only coins with real liquidity belong here; adding one is a single line in `src/dex/chains.js`.
**WMON:** it is the same contract the app already used to stand in for MON, now listed as an ordinary token you can hold and trade. Picking MON on one side and WMON on the other says so plainly (they are the same value) instead of the vague "Pick two different tokens"; wrapping and unwrapping directly is not built yet.
**Source and screening:** monadvision.com sits behind a bot check that blocks automated reads, so the list comes from Monad's official token list on GitHub (125 tokens), which explorers use. All 125 were checked: 124 matched on-chain (the 125th is native MON, which has no contract), but only 63 had any KyberSwap route and many of those priced at a 30-100% loss or an impossible gain (no real liquidity or a bad price feed). Kept: coins within 0.5% at $16 and 0.25% at $166, and only standard transferable tokens. Left out on purpose: mcMON (1.6% loss at just $166), tokenised bonds and money-market funds (JAAA, KTB, CETES...) and vault shares, which can restrict who may hold them.

## Unreleased: coin and chain pickers that open in every wallet browser
**What:** the coin pills (MON, USDC) and the chain/provider dropdowns now open our own list, a sheet that slides up from the bottom, instead of the phone's native dropdown. The original field is still there underneath, so everything else in the app works as before.
**Why:** in Zerion's in-app browser, tapping a coin pill highlighted it but no list ever dropped down, because some wallet browsers never show native pickers. A list drawn by the page itself works anywhere. Checked in a phone-sized browser: tap opens the list, picking a coin updates the field and the pill.

## Unreleased: the Bushido swap panel starts on, and stays on, the chain your wallet is really on
**What:** the panel now asks the wallet itself which chain it is on (`eth_chainId`) instead of trusting AppKit's cached value, re-checks when you return to the tab, and uses that same answer when it confirms a chain switch.
**Why:** inside Zerion's in-app browser AppKit kept reporting Base while the wallet was already on Monad. The panel opened on Base with 0.001 ETH, and tapping Monad asked AppKit to switch to a chain the wallet was already on. No change event ever fired, so the switch never "confirmed". Asking the wallet removes the disagreement.

## Unreleased: balances show up in wallet in-app browsers
**What:** the Swap tab's "Balance" lines now read from our public chain RPCs first (with their fallbacks), fall back to the wallet's own connection, and retry once before giving up.
**Why:** in Zerion's in-app browser the wallet connection quietly refused balance reads, so both lines showed "Balance: —" even though quotes and swaps worked. Reading a balance doesn't need the wallet, so it no longer depends on it. Checked against the real chain: this wallet reads 15.73 MON and 0.18 USDC on Monad.

## Unreleased: Dojo garden, pet growth stages and daily bow
**What:** the Dojo card now opens on a late-1800s Japanese garden (torii gate, arched bridge, koi pond, stone lantern, maple, dojo hall). Your warrior has five ranks (Deshi, Samurai, Rōnin, Sensei, Meijin) with a progress bar to the next. The garden always shows its fullest look (five koi, a lit lantern, a red maple). A free daily "bow" keeps a streak. The card also warns when your wallet is low on MON for gas.
**Why:** the live Warrior contract only lets its owner change stats, so the pet could never grow. Growth is now *calculated* from what the contract does hold (level, days in the dojo) plus the bow streak, so it feels alive without a new contract. Honest limits: the streak is stored on this device only, and nothing is written on-chain. A shared leaderboard or on-chain growth needs a server store or a new contract, which are separate decisions.

## Unreleased: one wallet signature now covers every chain
**What:** switching chains no longer asks you to sign a message again. The sign-in you make once is reused on Base, Monad, Optimism, Ink, Unichain and Ethereum for the same wallet, and the check is remembered for 60 seconds so fast switches don't hit the sign-in service each time.
**Why:** the sign-in library only accepted a signature made on the *same* chain you were on, so every switch triggered a new prompt, and declining it sent you back to the last signed chain (the "can't leave Base" symptom). A signature proves you own the address, and an address is identical on every EVM chain, so reusing it is safe. Different wallets and non-EVM chains still need their own signature.

## Unreleased: red only when something has really stayed broken
**What:** a one-off glitch no longer shows red. The rule is the same in three read-only places:
- **Bridge health strip:** a failed check is retried once right away (if the retry works, the route is simply
  live). A failure that survives is **amber** ("unstable: check 1 of 3, may be a glitch"). Only three failed checks in
  a row, at least a minute apart, turn a route **red** ("down for about N min"). Clicking Re-probe repeatedly can't
  rush it, and one good check wipes the count. "Not configured" is unchanged (grey, never counted).
- **Dojo card:** the Monad read is retried once; if it still fails it is an amber "Can't reach Monad right now. This is
  usually brief." with Try again, not red.
- **Rewards tab:** loading rewards, opportunities or one chain is retried once; a failure is amber with "Tap Refresh".
Red is kept for things that are really wrong: a mismatched deposit address, a claim, swap or transaction that failed.
**Why:** a single failed probe used to turn a provider red at once, so a one-second hiccup looked like an outage.
Checked on the real providers (Aori, which is genuinely down, now starts amber at check 1 of 3) and in a real
browser. `src/utils/retry.js` and 11 new tests, using a fake clock so none of them wait.

## Unreleased: Bushido swap panel works on every chain, and a refused network switch is no longer silent
**What:** the gated swap panel on the Bushido tab is no longer fixed to ETH to USDC on Base. It has chain buttons
(Base, Monad, Optimism, Ink, Unichain), starts on the wallet's chain (or Monad if the wallet is on a chain the app
can't swap on), follows the wallet when it changes network, and swaps the chain's own coin to USDC (MON on Monad).
If the wallet refuses a switch, or says yes and never moves, the panel now says so. Also fixed: the amount and
slippage boxes stuck out of the card on a phone and their numbers were dark on dark.
**Why:** on the Bushido page the panel always pulled the wallet back to Base (`switchNetwork('base')`), so a
Monad user could not stay on Monad. Separately, the wallet library swallows a refused switch unless asked
(`throwOnFailure`), which our code never did anywhere, so a failed switch looked like "it won't let me".
`src/bushido-swap.js`, 7 new tests, checked in a real browser with a stand-in wallet (follows Base, switches to
Monad, refusal, never moves, unsupported chain). A real wallet was not tested here.

## Unreleased: safer deposit screen for NEAR Intents bridges
**What:** the box that appears after you create a bridge intent is now a "Review before you pay" screen:
what you send and receive (with the minimum), your wallet as the receiver, where a refund goes (and the refund
fee), the time, the provider, and the real deadline. A short "Why does my wallet need the funds?" explains that
a bridge doesn't move your coins: you pay on the source chain and the bridge's liquidity providers pay you on
the other from their own funds, so the money plus a little gas coin must be in your wallet first. "Send deposit
from wallet" is the main button; sending manually is tucked under "Advanced" with a warning about fake
look-alike addresses. Code in `src/bridge-deposit.js` and `src/bridge-deposit-ui.js`.
**Why:** the old box was a bare address, "Send exactly…" and "Copy address", with no destination, receiver or
refund address, exactly what a scam prompt looks like, and it said the address expires in "~10 min" when the
real deadline is 24 hours. Worse, nothing checked the address: it reached the page through our server.
**The check:** before the send button turns on, the browser asks NEAR's own status service (not our server) about
that exact address and confirms NEAR recorded it with YOUR wallet as both receiver and refund address, for the
amount and token you chose, as a live unexpired quote. A mismatch (including a look-alike of your address) shows
a red "Do not pay this address", keeps the button off and keeps the address off the page. If NEAR can't be
reached, nothing can be sent until "Check again" succeeds. The server now passes the deadline and refund fee
through. 16 new tests, plus the same check run against NEAR's real record for a real, unpaid intent. A real
deposit was not made here.

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
| **Swaps on Monad, 8 Nov 2026, 22:09 to 22:10 UTC** | 1 MON each, all succeeded: KyberSwap `0xde3fd12c8a885c690cf957fe2d50ec09937651d3a161ec0d9b377b1e2ae61455` and `0xf5dd30e2e2c3f4fe826fa94ace0f98dbc9accfa41ba859bd9d05a754b890eeb8`; 1inch `0x6155ed7377aeb098628ac857c44a64394cdaa59e52576a1f819c463388fb9171`; LI.FI `0x431f3b9b09c6f0f4cc299e948bfde98e84788fe4411fd37d0957caab0e4218fd` (LI.FI's native-to-token swap function). |
| **One failed swap (Monad, 21:28 UTC)** | 1inch `0x6e12a3940f801c3566576494c8831f7f3a6b4178c3f0680d8ca4334198443960`: reverted with a contract error before mining (a replay one block earlier also reverts, with or without extra gas), so the route or price had moved past the tolerance. It is not an out-of-gas failure: Monad charges the full gas limit on every transaction. Cost about 0.0325 MON. The next swap (KyberSwap, same minute) succeeded. |
| **Bridge, NEAR Intents, Base to Avalanche** | 0.30 USDC deposit on Base at 20:34:17 UTC (`0x97bcfe73b151b31e42728f8dd49d96c674cc73648ed4b9f515efa59600a37ada`), 0.035812 AVAX delivered on Avalanche at 20:35:00 UTC (`0x2a7c09f619b7b92a953a4d43332b2d8a4a3c2c9753d9120a1e7107a00d22b809`): 43 seconds, matching the quoted rate. |
| **Merkl claim (Monad)** | 7 tokens in one claim, succeeded. `0xce9b3703af85824cb6da9b279637403e9ab8c7c9625d79b9a344b571d29c27e1` |

Not seen on-chain yet: a 0x swap on Monad, a Fusion gasless order, Stargate and Aori bridges, a Base or Ethereum Merkl claim.

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
