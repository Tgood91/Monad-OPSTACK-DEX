# Bushido-dApp

> Formerly **Multi-Chain DEX**. The app, its installable mobile version and
> the wallet-connect popup are all named **Bushido-dApp**. Existing deployments
> must update `VITE_APP_NAME` (see [Upgrading from Multi-Chain DEX](#upgrading-from-multi-chain-dex)).

A swap aggregator and cross-chain bridge in one app.
Connect your wallet,
pick tokens, and it compares live quotes across 10 sources — best price wins.
Need to move funds between chains?
The Bridge tab' handles that too.
Out of gas on a chain? **⛽ Get gas** (top of the Bridge tab) turns USDC
on one chain into native gas (MON, ETH) in your wallet on another —
routed by NEAR Intents over HOT Protocol's bridge. Minimum $0.28.
No accounts, no custody. Your wallet signs every transaction; the app never
holds your funds or keys.

## What it does

**⇄ Swap tab** — Same-chain swaps on 5 chains (monad,  Optimism, Ink, Base,
Unichain). Quotes are fetched in parallel from every enabled source and
ranked by output. Tap any row to pick a different source than the winner.

**🌉 Bridge tab** — Cross-chain transfers via three providers:
NEAR Intents (Base, Ethereum, Optimism, Monad), Stargate V2 (Ethereum, Base,
Optimism, Arbitrum, Avalanche, BNB — same-asset only), and Aori (Ethereum,
Base, Optimism, Arbitrum, Monad, BNB). See [CHAINS.md](CHAINS.md).

**🧠 Intel tab** — Ask about DEX routing (1inch, Aerodrome, 0xSplits…) and get
a structured answer with a query, result table and chart. The figures are
fixed **sample data**, labeled as such in the UI — not live on-chain results.

**⛩ Bushido tab** — The connected wallet's 7 virtue scores and the Seykota
trend signal (EMA12/26 on hourly ETH-USD). Scores read from the
`BUSHIDO_REGISTRY` contract when set; otherwise they show neutral 50% and the
signal stays virtue-gated.

**📱 Bushido-dApp (mobile app)** — The same app, installable on a phone's
home screen (Android: *Install*; iPhone: *Share → Add to Home Screen*).
Full-screen, works offline without ever caching prices. See
[Bushido-dApp/README.md](Bushido-dApp/README.md).

## Quote sources

| Source | Type | Chains | Key |
|---|---|---|---|
| Uniswap | Trading API (routing) | Base, Optimism, Ink, Unichain | Server-side (`UNISWAP_API_KEY`) |
| Coinbase | CDP Swap API | Base | Server-side (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`) |
| Aerodrome | On-chain | Base | None |
| Velodrome | On-chain | Optimism, Ink | None |
| KyberSwap | Aggregator | Base, Monad, Optimism, Unichain | None |
| LI.FI | Aggregator | All 5 | None |
| Velora | Aggregator (ex-ParaSwap) | Base, Optimism, Unichain | None |
| 1inch | Aggregator | Base, Monad, Optimism, Unichain | Server-side (`ONEINCH_API_KEY`) |
| 1inch Fusion | Gasless intent swaps (sign an order, resolvers fill it and pay gas) | Base, Optimism, Monad, Unichain | Server-side (`ONEINCH_API_KEY`, same key as 1inch) |
| 0x | Aggregator | All 5 | `VITE_0X_API_KEY` (browser) |
| Zerion | Aggregator | Base, Optimism, Ink, Unichain | Server-side (`ZERION_API_KEY`) |

Server-keyed sources keep their secrets in the backend — they never reach the
browser. 0x is the only client-side key; it's a rate-limit key with origin
restrictions, the standard pattern for that provider.

## How a swap works

1. You enter an amount. The app fans out quote requests to every enabled
   source (8s timeout each) and shows them side by side.
2. Pick the best (or any) quote. The app checks token allowance and asks for
   an approval only if needed.
3. Before asking for your signature, the transaction is **simulated**
   (`eth_call`). If it would revert — stale quote, moved liquidity — no
   signature request happens.
4. You sign in your wallet. Done. The approval spender always comes from the
   real built transaction, never hardcoded.

### 1inch Fusion (gasless swaps)

Pick **1inch Fusion** in the quote list. You sign an order in your wallet (no gas, no
transaction); 1inch's resolvers compete to fill it and pay the gas. **Funds only move
when the order is filled**, so an unfilled or expired order costs nothing. Notes:
- You sell an **ERC-20 token** (e.g. USDC → MON). The native coin has no allowance to
  sign against, so a native sell shows "Fusion sells tokens, not the native coin".
- First use of a token needs a one-time **approval** of 1inch's order contract.
- "Min received" is the guaranteed minimum (the auction's end amount). If the price moved
  against you by more than your slippage setting when you sign, the app refuses first.
- The browser uses `@1inch/fusion-sdk` through our relay (`/api/fusion`, `server/fusion-relay.js`),
  which adds the API key on the server and only forwards quote, order and status calls.

## How a bridge works

1. Pick from/to chains and tokens, enter an amount, get a NEAR Intents quote
   (keyless; a 0.25% fee applies without an API key). ##NOT FOREVER##
2. Hit Bridge: the backend creates an intent and returns a deposit address
   (valid ~10 minutes).##USUALLY 10MIN MAX-IF FAILS REFUNDED IMMEDIATELY AFTERWARDS##
3. Your wallet switches to the origin chain and sends the exact amount —
   native transfer or ERC-20 `transfer`, no approval needed.
4. Status polls every 10 seconds: deposit → processing → done. Refunds go
   back to your wallet automatically on failure.

## Running it

From the repo root:

```bash
npm install && npm run build
cd server && npm install && npm start   # → http://localhost:3001
```

One process serves the built frontend and the API on the same port.

For development:

```bash
npm run dev        # Vite on :5173, proxies /api → :3001
cd server && npm start
```

**Frontend env** — copy `.env.example` to `.env` and set `VITE_PROJECT_ID`
(from [cloud.reown.com](https://cloud.reown.com)) — required for the wallet
modal. Optional: `VITE_0X_API_KEY` (enables the 0x source).

App identity, shown in the wallet-connect popup:

| Variable | Default | Notes |
|---|---|---|
| `VITE_APP_NAME` | `Bushido-dApp` | Overrides the default name. Leave unset, or set it to `Bushido-dApp`. |
| `VITE_APP_DESCRIPTION` | — | One line shown under the name |
| `VITE_APP_URL` | the page's own origin | Set to your public URL in production |
| `VITE_APP_ICON` | — | Square icon URL, e.g. `https://your-domain.com/Bushido-dApp/icons/icon-512.png` |

The page title, heading and installed-app name are fixed in the code
(`index.html`, `Bushido-dApp/manifest.webmanifest`). Only the wallet popup
reads these variables.

**Server env** — copy `server/.env.example` to `server/.env`. The backend
reads the CDP secret from `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`, falling
back to the `coinbase` CLI config on the machine. Zerion needs
`ZERION_API_KEY`, Uniswap needs `UNISWAP_API_KEY`, and 1inch needs
`ONEINCH_API_KEY`. (If the Uniswap/1inch env keys are unset, the server falls
back to the Secure Vault surrogate socket, which only exists on the original
dev machine. NEAR Intents uses the vault when available and otherwise runs
keyless.)

## Deploying

See [DEPLOY.md](DEPLOY.md) for a full Node.js guide (env, build, pm2,
nginx, `TRUST_PROXY`) and [REPLIT_DEPLOY.md](REPLIT_DEPLOY.md) for Replit. Any
Node host works: build the frontend, run `node server/index.js`, set `PORT`.

Remember: `VITE_*` values are baked into the frontend at build time, so set
them before building.

### Upgrading from Multi-Chain DEX

An existing `.env` copied from the old `.env.example` still contains
`VITE_APP_NAME=Multi-Chain DEX`. Because a set variable overrides the
default, the wallet popup keeps showing the old name until you change it:

```bash
# .env on your server (or your host's environment settings)
VITE_APP_NAME=Bushido-dApp
```

Then rebuild (`npm run build`) and restart. The page heading, browser tab
and installed app are already renamed by the code itself.

## Project layout

```
.
├── index.html            # UI shell + styles (Swap | Bridge | Intel | Bushido | Rewards tabs)
├── vite.config.js        # build config, dev /api proxy
├── server/
│   ├── index.js          # Express: /api/* + serves the frontend
│   ├── uniswap.js        # Uniswap Trading API (UNISWAP_API_KEY, server-side)
│   ├── coinbase.js       # CDP Swap quotes + spot prices
│   ├── oneinch.js        # 1inch swap API (ONEINCH_API_KEY, server-side)
│   ├── fusion-relay.js   # /api/fusion: Fusion quote/order/status relay (adds the key)
│   ├── zerion.js         # Zerion swap quotes (ZERION_API_KEY, server-side)
│   ├── near.js           # NEAR Intents 1Click client (bridging)
│   ├── stargate.js       # Stargate V2 bridging (on-chain, keyless)
│   ├── aori.js           # Aori intent bridging (EIP-712 orders)
│   ├── bushido.js        # virtue scores + Seykota trend signals
│   ├── Dex-intellegence.js # Intel tab answers (canned SAMPLE data)
│   ├── merkl.js          # Merkl rewards: opportunities, claim calldata
│   └── stream.js         # Live price ticker (WebSocket, REST fallback)
├── src/
│   ├── main.js           # swap tab: rendering, quoting, swap flow
│   ├── bridge.js         # bridge tab: NEAR / Stargate / Aori flows
│   ├── intel.js          # Intel tab: ask -> reasoning, table, chart, answer
│   ├── bushido-mount.jsx # mounts the React Bushido tab (lazy-loaded)
│   ├── BushidoTradingDashboard.jsx # virtue scores + strategy signals (React + Tailwind)
│   ├── merkl.js          # Rewards tab: opportunities + wallet-signed claiming
│   ├── config.js         # wallet (AppKit) setup, Aave-style modal theme
│   ├── dex/
│   │   ├── chains.js     # chain + token + source registry
│   │   ├── adapters.js   # one quote()/buildTx() adapter per source
│   │   ├── fusion-core.js   # 1inch Fusion: quote, sign, submit, wait for fill (lazy-loaded)
│   │   ├── fusion-wallet.js # connects the wallet to fusion-core
│   │   └── engine.js     # parallel fan-out, best-wins
│   └── utils/            # wallet helpers, formatting, ABIs
├── Bushido-dApp/         # installable mobile app (PWA): manifest, service
│                         # worker, icons, install banner — see its README
└── contracts/
    └── VirtueFeeRouter.sol  # virtue-score fee discounting (deploy-virtuefeerouter*.js)
```

**Planned (not yet in the repo):** `server/relayer.js` (intent relay + tx
submission), `src/dex/solvers.js` (solver registry, selection + quoting).

## Notes & limits

- Monad swaps go through aggregators only (LI.FI, KyberSwap, 1inch, 0x).
  The app opens on Monad with 1 MON → USDC prefilled. Direct Uniswap V3 swaps aren't used there: its factory uses a
  non-canonical pool init-code hash, so direct on-chain swaps revert. A
  source that doesn't route on Monad shows "no liquidity".
- 1Click doesn't list Ink or Unichain — bridging is limited to the
  chains it supports.
- Quotes are point-in-time. The pre-sign simulation is the safety net, not a
  guarantee — always double-check amounts in your wallet before signing.
-CCTPV2 will also be integrated for faster bridging of stables. 
- **HOT Protocol:** ⛽ Get gas covers every EVM chain NEAR Intents delivers
  over HOT's bridge (asset ids `v2_1.omni.hot.tg:*`): Monad, Optimism, BNB
  Chain, Avalanche, Polygon, Scroll, X Layer and ADI, plus Base and Ethereum
  via NEAR's own bridge. Pay with USDC on Base, Optimism, Ethereum or Monad;
  minimum $0.28. Bridges can set higher minimums (e.g. ADI about $0.31; BNB
  had a temporary $1,000 minimum on 2026-11-05), and the quote shows it.
  Not included: Plasma (deprecated), TON and Stellar (need non-EVM addresses). The `@hot-labs/omni-sdk` package itself is not used yet: its
  deposits need a funded NEAR relayer account (private key on the server).
  drip-tools / gas.zip are not integrated.
