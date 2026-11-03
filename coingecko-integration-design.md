# CoinGecko integration — design brief (draft, not wired)

Prepared 2026-10-19 while the tier question is pending. Nothing here touches
the running app; wiring starts from Tanner's one-word tier answer.

## What it fills (two real gaps)
1. **Token discovery** — Swap token lists are hardcoded (a handful per chain).
   CoinGecko search → type any token, get its verified contract address on the
   current chain, addable to the picker.
2. **Independent USD prices** — amounts/balances today only show aggregator
   estimates, and not every source returns one. CoinGecko is the display layer
   for prices; aggregators stay the source of truth for executable quotes.

## Architecture (both tiers)
- Server-side proxy `server/coingecko.js` — key never reaches the browser
  (same surrogate pattern as the 1inch/Uniswap/Zerion proxies).
- Endpoints: `GET /api/coingecko/search?q=` (token → contract addresses),
  `GET /api/coingecko/price?chain=<chain>&contract=<0x…>` (USD price).
- Frontend: search box in the token picker; price display prefers CoinGecko,
  falls back to the aggregator estimate when absent.

## Tier A — free/demo key (~5–15 calls/min)
- In-memory TTL cache: search results 5 min, prices 60 s; dedupe in-flight
  requests so one search = one upstream call no matter how many keystrokes.
- Rate-limit guard: if 429, serve stale cache and mark prices "est." in the UI.
- This is the expected shape for a demo key; fine at his cadence.

## Tier B — paid key
- Same proxy, higher limits: cache can drop to ~15 s for prices; search can
  prefetch top-100 tokens per chain at boot for instant picker results.

## Open questions (his answers unblock wiring)
- What "Infrastructure" means — plan tier vs CoinGecko's enterprise product.
- Whether CoinGecko covers Monad mainnet as an asset platform (testnet tokens
  are NOT on CoinGecko — discovery stays mainnet-only; Monad testnet keeps
  hardcoded lists).
- Demo key vs real key — changes only the cache TTLs, not the design.
