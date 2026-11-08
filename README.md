# Bushido-dApp

A non-custodial **swap aggregator and cross-chain bridge**, built around **Monad**, with a small game layer
(the **Dojo**: a Dojo Pass and a warrior pet) and a virtue-gated trading panel.

Connect a wallet, pick two coins, and the app asks every enabled liquidity source for a live quote in parallel.
The best price wins, and you can pick any other quote by hand. Need to move funds between chains? The Bridge
tab compares three providers and checks the bridge deposit address against the provider's own records before
you pay it.

**Your wallet signs every transaction. The app never holds your funds or your keys.** The one exception is the
optional Monad faucet, which holds a small dedicated key and is described in [Faucet](#monad-faucet-optional).

> Formerly **Multi-Chain DEX**. See [Upgrading from Multi-Chain DEX](#upgrading-from-multi-chain-dex).
> A running history of every change, and the reasoning behind it, is in [CHANGELOG.md](CHANGELOG.md).

---

## Contents

1. [What's in the app](#whats-in-the-app)
2. [Chains and coins](#chains-and-coins)
3. [Quote sources](#quote-sources)
4. [How a swap works](#how-a-swap-works)
5. [How a bridge works](#how-a-bridge-works)
6. [The Dojo (Monad)](#the-dojo-monad)
7. [Safety model](#safety-model)
8. [Running it](#running-it)
9. [Configuration](#configuration)
10. [Deploying](#deploying)
11. [Testing and CI](#testing-and-ci)
12. [API reference](#api-reference)
13. [Project layout](#project-layout)
14. [Notes and limits](#notes-and-limits)
15. [License](#license)

---

## What's in the app

| Tab | What it does |
|---|---|
| **Swap** | Same-chain swaps on 5 chains. Quotes from up to 10 sources, ranked by output. The app opens on **Monad** with 1 MON → USDC prefilled. |
| **Bridge** | Cross-chain transfers through NEAR Intents, Stargate V2 and Aori, with a live **health strip** that shows which routes are working. Also **⛽ Get gas**: turn USDC on one chain into native gas (MON, ETH) on another. |
| **Intel** | Ask about DEX routing and get a structured answer (query, table, chart). The figures are fixed **sample data**, and the UI says so. |
| **Bushido** | Your **Dojo** card (pass, warrior, garden), the 7 virtue scores, the Seykota trend signal and a **gated swap panel** that works on any chain. |
| **Rewards** | Merkl rewards: see your opportunities and claim, signed by your own wallet. |

It is also an **installable app**: a PWA for phones ([Bushido-dApp/README.md](Bushido-dApp/README.md)) and an
Android wrapper ([Bushido-dApp-android/README.md](Bushido-dApp-android/README.md)) with social login intact.

---

## Chains and coins

Swap chains: **Monad (default)**, Base, Optimism, Ink, Unichain. Ethereum is also configured so the wallet can
switch to it for Merkl claims. Bridge chains and which provider covers each are in [CHAINS.md](CHAINS.md).

Monad is the wallet library's default network, so a wallet that is already on Monad is not pulled to another chain
when it connects.

### Monad coins (20)

`MON`, `USDC`, `WMON`, `USDT0`, `WETH`, `WBTC`, `AUSD`, `sMON`, `gMON`, `shMON`, `GHO`, `cbBTC`, `LBTC`, `Cake`,
`avUSD`, `mUSD`, `XAUt0`, `aprMON`, `syrupUSDC`, `MONAZ`.

Every coin was checked before it was added: the contract was read on Monad (name, symbol, decimals) and had to
match Monad's [official token list](https://github.com/monad-crypto/token-list); and a live KyberSwap route had to
price it from MON with under 0.5% loss at $16 and 0.25% at $166. Tokenised bonds, funds and vault shares, and coins
without real liquidity, are left out on purpose. `MONAZ` is a small community token (its pool is only about $2k, so
keep swaps small). Adding a coin is one line in `src/dex/chains.js`; `test/monad-tokens.test.js` checks addresses
and decimals.

`MON` is the native coin. Its address in the list is the **WMON** contract, used as the placeholder for native
MON. `WMON` is also listed as an ordinary token. Picking MON on one side and WMON on the other shows a plain
explanation (they are the same value); wrapping directly is not built into the swap.

### The coin picker

Coin and chain lists open as our own **bottom sheet** instead of the phone's native dropdown, because some wallet
in-app browsers (Zerion's, for one) never show native pickers. The original `<select>` stays in the page as the
single source of truth (`src/token-picker.js`).

---

## Quote sources

| Source | Type | Chains | Key |
|---|---|---|---|
| Uniswap | Trading API (routing) | Base, Optimism, Ink, Unichain | Server-side (`UNISWAP_API_KEY`) |
| Coinbase | CDP Swap API | Base | Server-side (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`) |
| Aerodrome | On-chain | Base | None |
| Velodrome | On-chain | Optimism, Ink | None |
| KyberSwap | Aggregator | Base, Monad, Optimism, Unichain | None (a public client ID is set in `src/dex/adapters.js`) |
| LI.FI | Aggregator | All 5 | None |
| Velora | Aggregator (ex-ParaSwap) | Base, Optimism, Unichain | None |
| 1inch | Aggregator | Base, Monad, Optimism, Unichain | Server-side (`ONEINCH_API_KEY`) |
| 1inch Fusion | Gasless intent swaps | Base, Optimism, Monad, Unichain | Server-side (same 1inch key) |
| 0x | Aggregator, called through our server | All 5 | Server-side (`ZEROX_API_KEY`) |
| Zerion | Aggregator | Base, Optimism, Ink, Unichain | Server-side (`ZERION_API_KEY`) |

On **Monad** the sources are LI.FI, KyberSwap, 1inch, Fusion and 0x. A source that does not route on a chain shows
"no liquidity" in the quote list.

Server-keyed sources keep their secrets on the backend; they never reach the browser. Quote sources are called in
parallel with a per-source timeout, and one source failing never blocks the others (`src/dex/engine.js`,
`src/dex/resilience.js`).

---

## How a swap works

1. You enter an amount. The app fans out quote requests to every enabled source and shows them side by side.
2. Pick the best (or any) quote. The app checks token allowance and asks for an approval only if needed.
3. Before asking for your signature, the transaction is **simulated** (`eth_call`). If it would revert (stale
   quote, moved liquidity), no signature request happens.
4. You sign in your wallet. The approval spender always comes from the real built transaction, never hardcoded.

### The dry-run check, and why it asks the public RPC first

Some wallet in-app browsers refuse `eth_call` through the wallet's own connection and answer with a bare
"Call failed". That is the wallet declining to answer, not the swap failing. So `src/simulate.js` asks our public
RPC for the wallet's chain first, then the wallet:

- a **real revert** blocks the swap, with its reason;
- a wallet that **can't cover the amount** gets a plain "Not enough in this wallet to cover this amount plus gas";
- if **nobody can answer**, nothing is sent and the message says "Couldn't check this right now", never that the
  swap would fail.

Balances use the same rule: public RPC first, wallet second, one retry (`src/main.js`).

### 1inch Fusion (gasless swaps)

Pick **1inch Fusion** in the quote list. You sign an order in your wallet (no gas, no transaction); 1inch's
resolvers compete to fill it and pay the gas. **Funds only move when the order is filled**, so an unfilled or
expired order costs nothing.

- You sell an **ERC-20 token** (for example USDC → MON). The native coin has no allowance to sign against.
- The first use of a token needs a one-time approval of 1inch's order contract.
- "Min received" is the guaranteed minimum. If the price moved against you by more than your slippage setting when
  you sign, the app refuses first.
- The browser uses `@1inch/fusion-sdk` through our relay (`/api/fusion`, `server/fusion-relay.js`), which adds the
  API key on the server and only forwards quote, order and status calls.

### The Bushido swap panel

On the Bushido tab, a gated swap panel trades the chain's native coin for USDC on **any** chain. It starts on the
chain your wallet is really on (it asks the wallet with `eth_chainId` instead of trusting a cached value) and follows
you when you switch. A trade goes out only if slippage is **0.1%–1%** and the dry-run passes. After a swap, the
transaction hash is a link to that transaction on the chain's explorer.

---

## How a bridge works

Three providers, compared side by side:

| Provider | Covers | Notes |
|---|---|---|
| **NEAR Intents** | Base, Ethereum, Optimism, Monad | You pay a one-time deposit address; liquidity providers pay you on the destination chain. |
| **Stargate V2** | Ethereum, Base, Optimism, Arbitrum, Avalanche, BNB | Same-asset only. |
| **Aori** | Ethereum, Base, Optimism, Arbitrum, Monad, BNB | Intent-based (EIP-712 orders). |

A fourth, **1inch Fusion+**, is wired in but off until a vault socket is configured.

### The "review before you pay" screen (NEAR Intents)

A NEAR deposit address is a fresh address, so the screen is built so you never have to take our server's word for it:

1. The deposit address is **not shown** until the browser has asked **NEAR's own status service** (not our server)
   about that exact address and confirmed NEAR recorded **your wallet** as both the receiver and the refund address,
   for the amount you chose, as a live quote.
2. The **Send** button stays disabled until that check passes. A mismatch shows exactly what differs, and the send
   is refused.
3. The screen shows what you send, what you receive (and the guaranteed minimum), where it lands, your refund
   address, the deadline (**Send before …**) and a short explanation of why the wallet must already hold the funds
   plus a little gas.

If a bridge fails, it is refunded to the same wallet. The deposit address has a deadline shown on screen; send before
it. (`src/bridge-deposit.js`, `src/bridge-deposit-ui.js`.)

### Bridge route health

The strip at the top of the Bridge tab probes each provider with a real 1-USDC quote on canary routes and shows
which are working. It follows **"red only when confirmed"**: a failed check is retried once quietly; if it still
fails the route is **amber** ("unstable, check 1 of 3, may be a glitch"); it turns **red** only after 3 failed checks
in a row, at least a minute apart (`server/bridge-health.js`).

---

## The Dojo (Monad)

The **Your Dojo** card on the Bushido tab is built on three contracts on Monad mainnet (chain 143):

| Contract | Address | Purpose |
|---|---|---|
| **Dojo Pass** (`BushidoDojoGate`) | `0x2647faf3aaa708d0b9a110744790e1f637fcca53` | `purchasePass()` for a small MON fee (0.001 MON), forwarded to the treasury. Holding a pass is a yes/no flag per wallet. The owner can grant or revoke a pass and change the fee. |
| **Warrior** (`BushidoProtocol`) | `0xafa3dd46746e39a89d411260d93e7514ab99b96e` | `enterDojo()` registers **one warrior per wallet** (no pass needed). It stores `createdAt`, `lastActivity`, `level` (starts at 1), `honor` (72), `reputation` (50) and `achievements` (0). The only thing the contract lets anyone change afterwards is `honor`, and only the owner can (`adjustHonor`). |
| **Bushido Honor** (`BushidoVirtueRegistry`) | `0x46d5f4924f833cd4054a36eaefa3beca6cd92a7e` | ERC-721 virtue registry: per-trader virtue scores (`gi`, `yu`, `jin`, `rei`, `makoto`), trade records, honor tiers and badges. A "virtue controller" address can submit trades. Deployed; not used by the app yet. |

**All three contracts' source is public and verified on Sourcify** (a "perfect" match with the deployed code), so you
can read exactly what they do. Fetch a contract's files from
`https://sourcify-api-monad.blockvision.org/files/143/<address>`. Monadscan does not list them as verified; that is a
gap in Monadscan's database, not a sign anything is wrong.

One naming caveat: the Warrior contract calls its two meters `honor` and `reputation`, but the card currently labels
them "Vitality" and "Focus" (`STAT_LABELS` in `src/dojo/dojo-core.js`), which were guesses made before the source was
found. Only `honor` can ever change on-chain.

### What the card shows

- A **garden** (late 1800s Japan): torii gate, arched bridge, koi pond, stone lantern, maple and a dojo hall, drawn
  as inline SVG (`src/DojoPond.jsx`).
- Your **warrior**: level, mood and the vitality and focus meters read from the chain.
- A **rank**: Deshi → Samurai → Rōnin → Sensei → Meijin. The live contract cannot change stats, so rank is
  *calculated* in the app from the warrior's level, days in the dojo and the bow streak (`src/dojo/growth.js`).
  Nothing is written on-chain.
- A free **daily bow** that keeps a streak. The streak is stored **on your device only**.
- A **low-gas warning** when your wallet holds under 0.02 MON, and the faucet offer if you qualify.
- **Buttons** to *Enter the Dojo* and *Get your Dojo Pass*. Each runs switch-to-Monad, dry-run, sign, wait
  (`src/dojo/dojo-tx.js`) and only asks you to sign if the dry-run passes.

### Pass perks (verified)

A wallet that holds a Dojo Pass can unlock a **3× quote allowance** (`PERK_QUOTE_MULTIPLIER`):

1. The wallet signs one short, plain message. It sends no transaction and costs no gas.
2. The server recovers the signer, asks **Monad itself** whether that wallet holds a pass, and issues a signed
   token (HMAC) valid for 7 days. The message is time-stamped (5 minutes) so it cannot be replayed.
3. The browser sends the token as `x-perk-token` on our own `/api` calls, which raises the quote rate limit.

The token only raises a request limit; it never touches funds. Set `PERKS_SECRET` in the server environment so
tokens survive a restart (without it, holders sign again after a restart). See `server/perks.js` and
`src/perks-client.js`.

### Monad faucet (optional)

Gives a brand-new wallet a small amount of MON so it can pay the gas to enter the Dojo or buy a pass
(`server/faucet.js`). It is **off** until `FAUCET_PRIVATE_KEY` is set.

This is the one place the server holds a private key, so keep the blast radius small:

1. Use a **new, dedicated wallet** that you use for nothing else. Never your main wallet, and never a Safe owner.
2. Keep only a few MON in it. A good pattern is a **Safe as the vault** (the bulk of the funds) and this small
   **burner as the till**; top the burner up from the Safe by hand when it runs low. A Safe itself cannot be the
   faucet wallet: it has no private key the server could use.
3. Put the key in your host's **Environment tab** only, never in the repo or in chat.
4. To switch it off, remove the key or set `FAUCET_DISABLED=1`.

Who can claim: a wallet with **no activity on Monad** (it has never sent a transaction and holds under
`FAUCET_MIN_BALANCE_MON`). That alone makes it one claim per wallet. Extra limits: one claim per visitor per day,
and a daily cap. The most the key can ever lose is the faucet wallet's own balance. When the wallet runs low or
empty, the Operations panel logs it (and emails it if Resend is set). Set `TRUST_PROXY=1` behind a proxy so the
per-visitor limit can tell visitors apart.

---

## Safety model

- **Non-custodial.** The server never signs on your behalf (faucet aside, which only sends its own small drip).
- **Simulate before signing.** Every swap and Dojo action is dry-run first; a revert means no signature request.
- **Independent verification of bridge addresses.** The browser asks the bridge's own status service, not our
  server, before showing a deposit address.
- **Secrets stay server-side.** Provider keys live in the server environment. Only the Reown project ID is public.
- **One sign-in covers every EVM chain.** A signature proves you own an address, and an address is the same on
  every EVM chain, so switching chains does not ask you to sign again (`src/siwx-share.js`). A different wallet, or
  a non-EVM chain, still needs its own signature.
- **Red only when confirmed.** Glitches retry quietly and show amber; red is for things that stayed broken or are
  really wrong (a mismatched deposit address, a revert, a failed claim). The Operations log records `high` only for
  a genuine on-chain revert.
- **Rate limits.** Each visitor gets 90 general requests a minute and a separate 400 a minute for quote lookups
  (`server/limits.js`); verified pass holders get the larger quote allowance.
- **Kill switches.** `DISABLED_SOURCES` turns any quote source off with no code change.

---

## Running it

From the repo root:

```bash
npm install && npm run build
cd server && npm install && npm start   # → http://localhost:3001
```

One process serves the built frontend and the API on the same port.

For development:

```bash
npm run dev          # Vite on :5173, proxies /api → :3001
cd server && npm start
```

---

## Configuration

### Frontend (`.env`, copy from `.env.example`)

`VITE_*` values are baked into the frontend **at build time**, so set them before building, and never put a secret
in one.

| Variable | Required | Notes |
|---|---|---|
| `VITE_PROJECT_ID` | **Yes** | Free Reown project ID from [cloud.reown.com](https://cloud.reown.com). Required for the wallet modal. |
| `VITE_APP_NAME` | No | Defaults to `Bushido-dApp`. Shown in the wallet-connect popup. |
| `VITE_APP_DESCRIPTION` | No | One line under the name. |
| `VITE_APP_URL` | No | Defaults to the page's own origin. Set to your public URL in production. |
| `VITE_APP_ICON` | No | Square icon URL. |

### Server (`server/.env`, or your host's Environment tab)

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3001). |
| `TRUST_PROXY` | Set to `1` behind a proxy so per-visitor limits work. |
| `CORS_ORIGIN` | Allowed browser origin(s). |
| `DISABLED_SOURCES` | Comma-separated sources to turn off, e.g. `zerion,fusion`. Names: `aerodrome, velodrome, uniswap, kyberswap, lifi, velora, coinbase, oneinch, fusion, zerox, zerion`. |
| `UNISWAP_API_KEY`, `ONEINCH_API_KEY`, `ZERION_API_KEY`, `ZEROX_API_KEY` | Quote source keys (`ONEINCH_API_KEY` also powers Fusion). 0x also accepts the older name `VITE_0X_API_KEY`, but use `ZEROX_API_KEY`: a `VITE_` value is meant for the browser. |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | Coinbase swap quotes. |
| `BUSHIDO_REGISTRY`, `BASE_RPC` | Optional virtue-score registry contract and its RPC. Without it, virtues show a neutral 50% and the Seykota signal stays gated. |
| `FAUCET_PRIVATE_KEY` | Turns the faucet on. See [Faucet](#monad-faucet-optional). |
| `FAUCET_DRIP_MON`, `FAUCET_MIN_BALANCE_MON`, `FAUCET_DAILY_CAP`, `FAUCET_RESERVE_MON`, `FAUCET_DISABLED` | Faucet tuning (defaults: 0.05 MON, 0.02 MON, 100 claims/day, 0.1 MON reserve). |
| `PERKS_SECRET`, `PERK_QUOTE_MULTIPLIER` | Pass-perk token secret and the allowance multiplier (default 3). |
| `RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` | Emails high-severity errors. Without them errors are still logged and shown. |
| `ANDROID_CERT_SHA256`, `ANDROID_PACKAGE_NAME` | Serve `/.well-known/assetlinks.json` for the Android app. |

If the Uniswap/1inch keys are unset, the server falls back to a Secure Vault surrogate socket that only exists on the
original dev machine. NEAR Intents uses the vault when available and otherwise runs keyless.

### Turning a source off

Set `DISABLED_SOURCES` and redeploy. Server-proxied sources answer 503 "turned off" and the app skips every listed
source (including the ones the browser calls directly) and greys out its chip. Use it when a provider has an outage
or you want to stop spending on it.

---

## Deploying

Any Node host works: build the frontend, run `node server/index.js`, set `PORT`. The reference deployment is a
**Render** web service on the `main` branch:

- **Build:** `npm ci && npm run build && cd server && npm ci`
- **Start:** `npm start`
- **Health check:** the service is set to `/healthz`, which simply returns the front page with a 200 (enough to show the
  server is up). The real status endpoint is `/api/health`: JSON listing which keys and sources are on.
- **Auto-deploy:** on every push to `main` (about 2 minutes). Keys go in the service's Environment tab.

See [DEPLOY.md](DEPLOY.md) for a full Node.js guide (env, build, pm2, nginx, `TRUST_PROXY`) and
[REPLIT_DEPLOY.md](REPLIT_DEPLOY.md) for Replit.

### Upgrading from Multi-Chain DEX

An `.env` copied from the old `.env.example` still contains `VITE_APP_NAME=Multi-Chain DEX`. A set variable overrides
the default, so the wallet popup keeps the old name until you change it to `Bushido-dApp`, rebuild and restart. The
page heading, browser tab and installed app are already renamed by the code.

---

## Testing and CI

```bash
npm test                 # node:test, covers the logic behind every feature
npm run build            # production build
npm run format:check     # Prettier, on the files this project formats
```

Tests live in `test/` and cover, among others: the quote engine, bridge routing, route health, the deposit-address
verifier, the faucet, pass perks (signature, token and limiter), the dry-run logic, the Dojo's on-chain decoding and
growth rules, the coin list, and the coin picker. External services are replaced with fakes so the suite is fast and
offline.

GitHub Actions runs `npm ci`, `npm test` and `npm run build` on every pull request. Pull requests carry a short
**what and why**, mirrored as an entry in [CHANGELOG.md](CHANGELOG.md).

---

## API reference

The server (`server/index.js`) exposes these under `/api`. Provider calls are proxied so keys stay server-side.

| Area | Endpoints |
|---|---|
| Health | `GET /api/health` (JSON: which keys, sources and the faucet are on). `/healthz` just returns the front page with a 200. |
| Bridge health | `GET /api/bridge/health` |
| NEAR Intents | `GET /api/near/tokens`, `POST /api/near/quote`, `POST /api/near/intent`, `POST /api/near/deposit-submit`, `GET /api/near/status` |
| Stargate | `GET /api/stargate/tokens`, `POST /api/stargate/quote`, `POST /api/stargate/build-tx` |
| Aori | `GET /api/aori/tokens`, `POST /api/aori/quote`, `POST /api/aori/sign-data`, `POST /api/aori/swap`, `GET /api/aori/status` |
| Swap quotes | `POST /api/uniswap/quote`, `POST /api/uniswap/swap`, `POST /api/oneinch/quote`, `POST /api/oneinch/swap`, `GET /api/zerox/quote`, `POST /api/zerion/quote`, `POST /api/coinbase/swap-quote`, `GET /api/coinbase/prices`, `/api/fusion/*` |
| Rewards | `GET /api/merkl/rewards`, `GET /api/merkl/claim-data`, `GET /api/merkl/opportunities` |
| Bushido | `GET /api/bushido/virtues`, `GET /api/bushido/strategies`, `POST /api/bushido/signal`, `GET /api/bushido/dashboard` |
| Intel | `POST /api/intel/ask` |
| Dojo | `GET /api/perks/status`, `POST /api/perks/claim`, `GET /api/faucet/status`, `POST /api/faucet/claim` |
| Operations | `GET /api/ops/log`, `POST /api/ops/log` |

---

## Project layout

```
.
├── index.html              # UI shell + styles (Swap | Bridge | Intel | Bushido | Rewards)
├── vite.config.js          # build config, dev /api proxy
├── CHANGELOG.md            # what changed in each PR, and why
├── CHAINS.md               # chain IDs and which bridge covers which chain
├── server/
│   ├── index.js            # Express: /api/* and serves the frontend
│   ├── limits.js           # request limits (general vs quote bucket, pass-holder multiplier)
│   ├── perks.js            # verified Dojo Pass perks (signed claim, HMAC token)
│   ├── faucet.js           # Monad starter-MON faucet (off unless a key is set)
│   ├── bridge-health.js    # route probes with "red only when confirmed"
│   ├── switches.js         # DISABLED_SOURCES kill switch
│   ├── ops.js              # Operations log + email alerts
│   ├── near.js stargate.js aori.js        # bridge providers
│   ├── uniswap.js oneinch.js zerion.js zerox.js coinbase.js   # keyed quote sources
│   ├── fusion-relay.js oneinch-fusion.js  # 1inch Fusion relay
│   ├── merkl.js            # Merkl rewards
│   ├── bushido.js          # virtue scores + Seykota trend signal
│   ├── Dex-intellegence.js # Intel tab answers (sample data)
│   ├── assetlinks.js       # Android /.well-known/assetlinks.json
│   └── stream.js macro.js  # live ticker and macro data
├── src/
│   ├── main.js             # swap tab
│   ├── bridge.js bridge-deposit*.js bridge-route.js bridge-health.js   # bridge tab
│   ├── merkl*.js           # Rewards tab
│   ├── BushidoPanels.jsx   # Bushido tab: swap panel, virtues, operations
│   ├── DojoCard.jsx DojoPond.jsx   # the Dojo card and garden
│   ├── dojo/               # dojo-core (chain reads), dojo-tx, growth (ranks + bow)
│   ├── simulate.js         # dry-run logic
│   ├── token-picker.js     # own coin/chain picker
│   ├── perks-client.js siwx-share.js   # pass perks, one sign-in for every EVM chain
│   ├── config.js           # wallet (AppKit) setup, default network = Monad
│   ├── dex/                # chains.js (chains, coins, sources), adapters, engine, Fusion
│   └── utils/              # wallet helpers, retry, formatting, ABIs
├── test/                   # node:test suite
├── contracts/              # VirtueFeeRouter.sol
├── Bushido-dApp/           # installable mobile app (PWA)
└── Bushido-dApp-android/   # Android wrapper (TWA)
```

---

## Notes and limits

- **Monad swaps go through aggregators only** (LI.FI, KyberSwap, 1inch, 0x, Fusion). Direct Uniswap V3 swaps are not
  used there: its factory uses a non-standard pool init-code hash, so direct on-chain swaps revert.
- **Quotes are point-in-time.** The pre-sign simulation is the safety net, not a guarantee. Always check amounts in
  your wallet before signing.
- **Bridging is limited to the chains each provider supports.** NEAR's 1Click does not list Ink or Unichain.
- **Dojo growth is calculated, not on-chain**, and the bow streak is per device. A shared leaderboard or on-chain
  growth needs a server store or a new contract.
- **Aori and Fusion+** depend on third-party services; the bridge health strip shows when a route is having trouble.
- **⛽ Get gas** covers every EVM chain NEAR Intents delivers over HOT's bridge (Monad, Optimism, BNB Chain,
  Avalanche, Polygon, Scroll, X Layer, ADI, plus Base and Ethereum via NEAR's own bridge). Pay with USDC on Base,
  Optimism, Ethereum or Monad; the minimum is about $0.28, and a bridge can set a higher one, which the quote shows.
  Plasma (deprecated), TON and Stellar (non-EVM addresses) are not included.
- CCTP v2 for faster stablecoin bridging is planned.

---

## License

[MIT](LICENSE) © 2026 Tgood91
