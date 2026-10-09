# Multi-Chain DEX

A swap aggregator and cross-chain bridge in one app. Connect your wallet,
pick tokens, and it compares live quotes across 10 sources — best price wins.
Need to move funds between chains? The Bridge tab handles that too.

No accounts, no custody. Your wallet signs every transaction; the app never
holds your funds or keys.

## What it does

**⇄ Swap tab** — Same-chain swaps on 5 chains (Celo, Optimism, Ink, Base,
Unichain). Quotes are fetched in parallel from every enabled source and
ranked by output. Tap any row to pick a different source than the winner.

**🌉 Bridge tab** — Cross-chain transfers via NEAR Intents (Base, Ethereum,
Optimism, Monad). Get a quote, send the exact amount to a deposit address
from your wallet, and watch the status track to completion.

## Quote sources

| Source | Type | Chains | Key |
|---|---|---|---|
| Uniswap | Trading API (routing) | All 5 | Server-side (vault) |
| Coinbase | CDP Swap API | Base, Ethereum | Server-side (vault/env) |
| Aerodrome | On-chain | Base | None |
| Velodrome | On-chain | Celo, Optimism, Ink | None |
| KyberSwap | Aggregator | Optimism, Ink, Base, Unichain | None |
| LI.FI | Aggregator | All 5 | None |
| Velora | Aggregator (ex-ParaSwap) | Optimism, Ink, Base, Unichain | None |
| 1inch | Aggregator | All 5 | `VITE_1INCH_API_KEY` |
| 0x | Aggregator | All 5 | `VITE_ZEROX_API_KEY` |
| Zerion | Aggregator | All 5 | `VITE_ZERION_API_KEY` |

Server-keyed sources keep their secrets in the backend — they never reach the
browser. Client keys are rate-limit keys with origin restrictions, the
standard pattern for these providers.

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
   (keyless; a 0.25% fee applies without an API key).
2. Hit Bridge: the backend creates an intent and returns a deposit address
   (valid ~10 minutes).
3. Your wallet switches to the origin chain and sends the exact amount —
   native transfer or ERC-20 `transfer`, no approval needed.
4. Status polls every 10 seconds: deposit → processing → done. Refunds go
   back to your wallet automatically on failure.

## Running it

```bash
cd dex-app
npm install && npm run build
cd server && npm install && npm start   # → http://localhost:3001
```

One process serves the built frontend and the API on the same port.

For development:

```bash
npm run dev        # Vite on :5173, proxies /api → :3001
cd server && npm start
```

Copy `.env.example` to `.env` and set `VITE_PROJECT_ID` (from
[cloud.reown.com](https://cloud.reown.com)) — required for the wallet modal.
Optional: `VITE_1INCH_API_KEY`, `VITE_ZEROX_API_KEY`, `VITE_ZERION_API_KEY`.

The backend reads the CDP secret from `CDP_API_KEY_ID` /
`CDP_API_KEY_SECRET` env vars, falling back to the `coinbase` CLI config on
the machine. The Uniswap key lives in the Secure Vault and is applied
server-side via a short-lived surrogate — the raw key never touches the
server's memory.

## Deploying

See [REPLIT_DEPLOY.md](REPLIT_DEPLOY.md) for Replit (Reserved VM). Any
Node host works: build the frontend, run `node server/index.js`, set `PORT`.

Remember: `VITE_*` values are baked into the frontend at build time, so set
them before building.

## Project layout

```
dex-app/
├── index.html            # UI shell + styles (Swap | Bridge tabs)
├── vite.config.js        # build config, dev /api proxy
├── server/
│   ├── index.js          # Express: /api/* + serves the frontend
│   ├── uniswap.js        # Uniswap Trading API (vault key, server-side)
│   ├── coinbase.js       # CDP Swap quotes + spot prices
│   ├── near.js           # NEAR Intents 1Click client (keyless bridging)
│   └── stream.js         # Live price ticker (WebSocket, REST fallback)
└── src/
    ├── main.js           # swap tab: rendering, quoting, swap flow
    ├── bridge.js         # bridge tab: quote → intent → deposit → status
    ├── config.js         # wallet (AppKit) setup
    ├── dex/
    │   ├── chains.js     # chain + token + source registry
    │   ├── adapters.js   # one quote()/buildTx() adapter per source
    │   └── engine.js     # parallel fan-out, best-wins
    └── utils/            # wallet helpers, formatting, ABIs
```

## Notes & limits

- Monad is bridgeable (via NEAR Intents) but not swappable in-app: its
  Uniswap V3 factory uses a non-canonical pool init-code hash, so direct
  on-chain swaps revert. Aggregators are the swap path there if ever added.
- 1Click doesn't list Celo, Ink, or Unichain — bridging is limited to the
  chains it supports.
- Quotes are point-in-time. The pre-sign simulation is the safety net, not a
  guarantee — always double-check amounts in your wallet before signing.
