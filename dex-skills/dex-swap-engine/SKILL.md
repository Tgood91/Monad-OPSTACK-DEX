---
name: dex-swap-engine
description: Build, extend, or debug the quote-fan-out and swap-execution engine in src/dex/ — adapters, chain registry, engine.js fan-out logic, slippage, pre-sign simulation, and allowance checks. Use when adding a new aggregator source, fixing a broken quote adapter, or changing swap execution flow.
---

# DEX Swap Engine

## Architecture

Three files own the whole swap path:

```
src/dex/
  chains.js    — chain + token + source registry (single source of truth)
  adapters.js  — one { quote(), buildTx() } object per source
  engine.js    — parallel fan-out, timeout, ranking, best-wins
```

`src/main.js` is the UI layer — it calls engine.js and renders results. Never put business logic there.

## Chain registry (`chains.js`)

### Adding a chain

1. Add an entry to `CHAINS` with: `key`, `label`, `chainId`, `native`, `color`, `rpcs[]`, `explorer`, `sources[]`, `tokens[]`.
2. Add the chain to `src/config.js` AppKit network list.
3. Add the chain to Reown cloud dashboard for wallet support.
4. Run `getChain(key)` sanity check in console — it throws on unknown keys.

### Adding a token

Push to the chain's `tokens` array. Fields: `symbol`, `address`, `decimals`, `isNative` (only for native gas token).

Use `NATIVE_SENTINEL = '0xEeee...'` for native-token address when an aggregator API requires it (do not store it in `tokens[]`).

### Source registry

`sources[]` on each chain controls which adapters run for that chain. `SOURCE_META` has display labels and tags. Both must be updated when adding a source.

Monad (chainId 143) uses aggregators only — no on-chain Velodrome/Aerodrome/Uniswap. Velora rejects chain 143 with "Invalid network" — keep it out of `monad.sources`.

## Adapter contract

Every adapter in `adapters.js` must implement:

```js
async quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps) -> Quote | null
async buildTx(quote, wallet, slippageBps, signer) -> { to, data, value, spender }
```

`Quote` shape:
```js
{ source: string, amountOut: bigint, amountOutUsd?: number, gasUsd?: number, raw: any }
```

`buildTx` must also attach `tokenIn`, `tokenOut`, `amountInWei` to the quote before calling it (engine.js does this).

Return `null` from `quote()` when the source has no route — never throw.

### On-chain adapters (Aerodrome, Velodrome)

- Pure view-call quotes via `ethers.Contract.staticCall` — no API keys.
- RPC fallback: `_readProvider()` tries each RPC in `rpcs[]` with a 6s timeout.
- Aerodrome (Base): 4-field Route struct `(from, to, stable, factory)`.
- Velodrome (Optimism, Ink): 3-field Route struct `(from, to, stable)`. CL pools use `tickSpacing` (1, 10, 50, 200).
- Both use `swapExactTokensForTokens` / `swapExactETHForTokens` for execution.

### Server-proxied adapters (Uniswap, 1inch, Zerion)

- API keys live in `server/.env` — never in the browser.
- Frontend calls `/api/uniswap/quote`, `/api/oneinch/quote`, `/api/zerion/quote`.
- Server modules: `server/uniswap.js`, `server/oneinch.js`, `server/zerion.js`.

### Client-side adapters (0x, KyberSwap, LI.FI, Velora, Coinbase)

- 0x: `VITE_0X_API_KEY` — rate-limit key, origin-restricted, safe to expose.
- KyberSwap, LI.FI, Velora: fully keyless.
- Coinbase: CDP Swap via `/api/coinbase/quote` (server-side key).

### Adding a new adapter

1. Create the object in `adapters.js` with `quote()` and `buildTx()`.
2. Add its key to `SOURCE_META` in `chains.js`.
3. Add it to `sources[]` on every chain it supports.
4. Export it from the `ADAPTERS` map at the bottom of `adapters.js`.
5. If it needs a server-side key: add the Express route in `server/index.js` and the module in `server/`.

## Engine (`engine.js`)

- `fetchQuotes(chainKey, tokenIn, tokenOut, amountIn, wallet)` — fans out to all `sources[]` for the chain in parallel, 8s timeout (`QUOTE_TIMEOUT_MS`), returns sorted array best-first.
- `executeSwap(quote, wallet, signer, slippageBps)` — calls `buildTx`, checks/requests allowance, runs `eth_call` simulation, then requests wallet signature.
- Pre-sign simulation: `eth_call` the built tx before prompting the user. If it reverts, surface the error — do NOT send the tx.
- Allowance check: read `allowance(wallet, spender)` on the ERC-20; request `approve` only if `< amountIn`. Spender comes from `buildTx` result — never hardcode a spender address.

## Common mistakes

- Do not put `VITE_0X_API_KEY` in server code — it's a browser env var.
- Do not hardcode spender addresses in adapters — always return `spender` from `buildTx`.
- Do not skip the `eth_call` simulation step.
- Do not add Velora to Monad sources — it returns "Invalid network" for chainId 143.
- When a token is native (`isNative: true`), use `value: amountInWei` in the tx and skip the allowance step.
