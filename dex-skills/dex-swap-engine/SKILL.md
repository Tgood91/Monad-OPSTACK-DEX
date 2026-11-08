---
name: dex-swap-engine
description: Build, extend, or debug the quote fan-out and swap path in src/dex/ - adapters, the chain registry, engine.js (quoteAll/buildTxFor), slippage, the pre-sign dry run (src/simulate.js) and allowance checks. Use when adding a quote source, debugging "no liquidity"/"key not set" rows, or changing how a swap is built or signed.
---

# DEX swap engine

## Architecture

```
src/dex/
  chains.js     chain + coin + source registry (single source of truth): CHAINS, SOURCE_META
  adapters.js   one adapter object per source: canQuote?(), quote(), buildTx()
  engine.js     quoteAll() fan-out and buildTxFor()
  resilience.js retry once on a temporary failure, then pause a failing source (1 min, growing to 30); read-only calls only
src/simulate.js dry run (eth_call) before any signature
src/main.js     UI: calls the engine, renders rows, does the allowance check, simulation and signing
```

Business logic belongs in `src/dex/` and the small modules next to it, not in `main.js`.

## Adapter contract (`adapters.js`)

```js
canQuote?(chainKey, tokenIn, tokenOut, wallet)  -> null | 'reason string'      // optional: "can't serve this pair"
async quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps) -> Quote | null
async buildTx(quote, wallet, slippageBps, signer) -> { to, data, value, spender }
// Quote = { source, amountOut: bigint, amountOutUsd?, gasUsd?, raw }
```

- Return `null` when there is simply no route ("no liquidity" in the list). `throw new Error('short plain reason')` when
  something is wrong: the engine shows the first 80 characters inline. A source failing never breaks the batch.
- `canQuote` returning a string skips the call without counting it as a failure (for example Fusion on a native sell, a
  keyed source needing a connected wallet, a chain a source does not cover).
- `buildTx` returns the **real** target and `spender` from the built transaction. The engine attaches `chainKey`,
  `tokenIn`, `tokenOut`, `amountInWei` to the quote.
- Native sells use `value: amountInWei` and skip the allowance step. Native coins are listed with the wrapped-native
  address and `isNative: true`; sources that need the "native" placeholder use `NATIVE_SENTINEL` (never stored in `tokens`).

## Engine (`engine.js`)

- `quoteAll({ chainKey, tokenIn, tokenOut, amountInWei, wallet, sources, slippageBps, disabled, onResult })` asks every
  listed source at once, each wrapped in a per-source timeout (`QUOTE_TIMEOUT_MS`, 8s) and `resilient()` (a transient 5xx/network error is retried once; a source that keeps failing is paused). `onResult` fires as
  each finishes so fast quotes show immediately. Returns `{ all, good, best, pending }`, ranked best `amountOut` first.
- Order of checks per source: switched off (`disabled`) -> `canQuote` -> API key present (`adapterKeySet`) -> quote.
- `buildTxFor(quote, wallet, slippageBps, signer)` calls the adapter's `buildTx`.

## Where the keys are

| Source | Where it runs | Key |
|---|---|---|
| Uniswap, 1inch, Zerion, Coinbase, **0x** | Server proxy (`server/*.js`) | Server env: `UNISWAP_API_KEY`, `ONEINCH_API_KEY`, `ZERION_API_KEY`, `CDP_API_KEY_*`, `ZEROX_API_KEY` |
| KyberSwap, LI.FI, Velora | Browser, keyless | none (Kyber sends a public client ID header) |
| Aerodrome, Velodrome | Browser, on-chain reads | none |
| 1inch Fusion | Browser SDK through `server/fusion-relay.js` | the 1inch key, added server-side |

**0x moved to the server**: 0x v2 needs a header browsers cannot send, so the page cannot call it. `server/zerox.js` makes
the call and keeps the key out of the page. Do not put any key in `VITE_*`. (`VITE_0X_API_KEY` is still read as a fallback
name so an old setting keeps working, but use `ZEROX_API_KEY`.)

## Adding a source

1. Write the adapter in `adapters.js` (contract above) and add it to the `ADAPTERS` map.
2. Add a label to `SOURCE_META` in `chains.js`.
3. Add it to `sources[]` on each chain **only after** it returned a live quote there (see
   [dex-chain-config](../dex-chain-config/SKILL.md): test each source through the app's own code against a live server).
4. Keyed? Add the proxy route in `server/index.js`, a module in `server/`, the env variable to the README table, and the
   source name to `KNOWN_SOURCES` in `server/switches.js`, so `DISABLED_SOURCES` can switch it off without a code change.
5. Add tests with an injected `fetch` (see [dex-test](../dex-test/SKILL.md)).

## Before a signature (`src/simulate.js`, used by `main.js` and the Bushido panel)

`runSimulation(providers, tx)` dry-runs the transaction. It asks **our public RPC for the wallet's chain first, then the
wallet**, because some wallet browsers (Zerion's) refuse `eth_call` and answer a bare "Call failed". Outcomes:

- a real revert -> blocked with its reason (`reverted: true`);
- not enough balance -> a plain "not enough in this wallet" message (`funds: true`);
- nobody can answer -> **nothing is sent**, and the message says "couldn't check", never that the swap would fail.

The Bushido panel's gate (`src/bushido-gate.js`) also requires slippage between 0.1% and 1%.

## Allowance

Read `allowance(wallet, spender)` and approve only if it is below the amount. The spender comes from `buildTx`, never a
constant. Balance reads follow the same rule as the dry run: public RPC first, wallet second.

## Common mistakes

- Putting a key in `VITE_*` or `src/`.
- Hardcoding a spender, or skipping the dry run.
- Listing a source on a chain because a support map says so, without testing it (Zerion refused a test wallet on BNB Chain
  and Avalanche although its map lists both).
- Adding Velora or Uniswap to Monad (Velora: "Invalid network"; Uniswap: non-standard pool init-code hash).
- Reading wallet-provider balances or `eth_call` directly: it fails silently in some wallet browsers.
- Treating `Fusion` as a general source: it sells ERC-20 tokens only (a signed order, no gas) and only fills when a resolver
  takes it.
