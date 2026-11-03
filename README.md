# Monad DEX — swap UI

Single-file swap UI for **Monad (chain 143)**: connect wallet → pick tokens →
quote via aggregators → swap through your own wallet. No build step.

Two frontends share the same swap engine:
- **`app.html`** — the polished UI (recommended): token modal, auto-quoting,
  flip button, quote details, MonadVision links.
- **`index.html`** — the original scaffold.

## Run it

```bash
cd ~/workspace/monad-dex
python3 -m http.server 8000
# open http://localhost:8000 in a browser with a wallet extension
```

## Flow

1. **Connect wallet** → requests accounts, switches to Monad (chain ID 143).
   If Monad isn't in the wallet yet, add it manually and reconnect.
2. **Pick From / To tokens** → local token list
   (MON, USDC, WMON, USDT0 — verified mainnet addresses).
   Balances show under each picker with a **MAX** button.
3. **Enter amount → Get quote** → the quote runs through six sources
   in failover order (8s timeout each, 100 bps max slippage, abort if all
   fail):

> **Zerion** — key verified live 2026-10-07, but Zerion's swap API does not
> support the Monad chain (every Monad quote returns 400). Adapter stays in
> the code, unwired, in case they add it.
   1. **KyberSwap** (no key) — verified working on Monad 2026-10-07
   2. **1inch** (needs API key) — router `0x1111…8842A65` verified on Monad (v6)
   3. **0x** (needs API key) — uses the current `allowance-holder` endpoint
   4. **LI.FI** (no key) — API only; thin Monad liquidity, works for small trades
   5. **OpenOcean** (no key) — Cloudflare-challenged from servers; may work in-browser

> **Uniswap (direct) — disabled 2026-10-07.** The official Uniswap contracts
> are deployed and verified on Monad (Universal Router v2.1.2
> `0xa6CE…596e`, V3 factory `0x204f…498`, SwapRouter02 `0xfe31…900`;
> WMON/USDC pools exist at tiers 100/500/3000/10000 with live prices).
> But Monad's V3 factory uses a **non-canonical pool init code hash**, so the
> canonical routers derive pool addresses containing no code (router computes
> `0x38d6…b482`, the real pool is `0x659b…4a9da`) and every V3 swap reverts.
> Proven via CREATE2 computation + `eth_call` dry-run. Re-enable if Uniswap
> redeploys canonical pools.

## Monad RPC fallbacks

Read-only calls can fail over across these public endpoints (chain 143)
via the `rpcRead()` helper — no wallet needed:

- `https://rpc.monad.xyz` (official primary)
- `https://rpc1.monad.xyz` (official secondary)
- `https://rpc4.monad.xyz`
- `https://rpc-mainnet.monadinfra.com`
- `https://monad-mainnet.gateway.tatum.io`
- `https://monad-mainnet.drpc.org`

   Pick a source manually with the Source dropdown, or leave it on Auto.
   Quoting is blocked if the amount exceeds your balance or From == To.
4. **Swap** → walks the quote's steps in order (approval first if needed),
   sending each transaction through the wallet and waiting for receipts.
   Balances refresh after the swap.

## Notes / limits

- Aggregator API keys (0x, 1inch) go in the `API_KEYS` const at the top of
  `index.html` — fill in locally for testing, never commit them. KyberSwap,
  LI.FI and OpenOcean need no key for quotes.
- Token decimals come from the local list; unknown tokens fall back to an
  on-chain `decimals()` call.
- Test with dust amounts first. This moves real money.
- `.env.example` in this folder is the template for project secrets —
  real keys live in the secure vault, never in the repo.
