# Multi-Chain DEX

A swap aggregator and cross-chain bridge in one app.
Connect your wallet,
pick tokens, and it compares live quotes across 10 sources — best price wins.
Need to move funds between chains?
The Bridge tab' handles that too.
the gas refill is included with the hot protocol sdk.
we have all have a gas station or "refill"
or just use one is the several intents/bridges!
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

## Project layout

```
.
├── index.html            # UI shell + styles (Swap | Bridge tabs)
├── vite.config.js        # build config, dev /api proxy
├── server/
│   ├── index.js          # Express: /api/* + serves the frontend
│   ├── uniswap.js        # Uniswap Trading API (UNISWAP_API_KEY, server-side)
│   ├── coinbase.js       # CDP Swap quotes + spot prices
│   ├── oneinch.js        # 1inch swap API (ONEINCH_API_KEY, server-side)
│   ├── zerion.js         # Zerion swap quotes (ZERION_API_KEY, server-side)
│   ├── near.js           # NEAR Intents 1Click client (bridging)
│   ├── stargate.js       # Stargate V2 bridging (on-chain, keyless)
│   ├── aori.js           # Aori intent bridging (EIP-712 orders)
│   ├── bushido.js        # virtue scores + Seykota trend signals
│   ├── Dex-intellegence.js # Intel tab answers (canned SAMPLE data)
│   └── stream.js         # Live price ticker (WebSocket, REST fallback)
├── src/
│   ├── main.js           # swap tab: rendering, quoting, swap flow
│   ├── bridge.js         # bridge tab: NEAR / Stargate / Aori flows
│   ├── intel.js          # Intel tab: ask -> reasoning, table, chart, answer
│   ├── bushido-mount.jsx # mounts the React Bushido tab (lazy-loaded)
│   ├── BushidoTradingDashboard.jsx # virtue scores + strategy signals (React + Tailwind)
│   ├── config.js         # wallet (AppKit) setup, Aave-style modal theme
│   ├── dex/
│   │   ├── chains.js     # chain + token + source registry
│   │   ├── adapters.js   # one quote()/buildTx() adapter per source
│   │   └── engine.js     # parallel fan-out, best-wins
│   └── utils/            # wallet helpers, formatting, ABIs
└── contracts/
    └── VirtueFeeRouter.sol  # virtue-score fee discounting (deploy-virtuefeerouter*.js)
```

**Planned (not yet in the repo):** `server/relayer.js` (intent relay + tx
submission), `server/merkl.js` (Merkl v4 incentives), `src/dex/solvers.js`
(solver registry, selection + quoting).

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
-also hot-protocol has a gas refill that I've built in. in the meantime trying to get drip-tools/gas . Zip Integrated ASAP!
