# Multi-Chain DEX — dex.html

The solid, long-lasting build. Config-driven, no API keys, best-price-wins.

## Chains (all tested live 2026-10-07)

| Chain | Sources |
|---|---|
| Celo (42220) | Velodrome (on-chain), LI.FI |
| Optimism (10) | Velodrome (on-chain), KyberSwap, LI.FI, Velora |
| Ink (57073) | Velodrome (on-chain), LI.FI |
| Base (8453) | KyberSwap, LI.FI, Velora |
| Unichain (130) | KyberSwap, LI.FI, Velora |

## Architecture

**Config-driven.** To add a chain, add one entry to `CHAINS` with: chainId, RPCs (with fallbacks), explorer, token list, and which sources to enable. To add a source, implement the adapter interface and add it to `ADAPTERS` + `SOURCE_META`. No other changes needed.

**Adapter interface** (all four implement this):
- `quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps)` → normalized `{ source, amountOut, amountOutUsd?, gasUsd?, raw }` or `null`
- `buildTx(quote, wallet, slippageBps)` → `{ to, data, value, spender }`

**Quote engine:** all enabled sources queried in parallel, 8s timeout each. Results normalized, sorted best-first. Failed sources show their reason inline — one source down never breaks the app.

**Safety:**
- Every swap is `eth_call`-simulated before the wallet ever sees it. Reverted simulation = no signature request.
- Approval flow checks allowance against the actual spender from the built tx.
- Slippage is user-set (0.3/0.5/1% presets + custom), applied per-source in its native format.
- Min-received shown before swap.

## Sources

- **Velodrome** — on-chain quoting via Slipstream CL quoter + v2 router. Tries CL tick spacings 1/10/50/200, then v2 stable/volatile. No API, no key. Contract addresses verified on-chain per chain (OP uses original deployment, Celo/Ink use Superchain).
- **KyberSwap** — REST aggregator, keyless. `/routes` → `/route/build`.
- **LI.FI** — REST aggregator, keyless. Quote returns executable `transactionRequest`.
- **Velora** (ParaSwap) — REST aggregator, keyless. `/prices` → `/transactions/{network}`.

## Files

- `dex.html` — this app (new, standalone)
- `multichain.html` — earlier Velodrome-only prototype (kept, untouched)
- `app.html` — Monad-only polished DEX (kept, untouched)
- `opstack-test-results.md` — live test data backing the chain/source matrix
