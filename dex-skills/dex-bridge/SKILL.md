---
name: dex-bridge
description: Build, debug, or extend the cross-chain bridge tab — NEAR Intents, Stargate V2, and Aori flows in src/bridge.js and server/near.js / server/stargate.js / server/aori.js. Use when fixing bridge quote failures, adding CCTPV2, debugging deposit-address expiry, or wiring in drip-tools gas refill.
---

# Bridge

## Architecture

The bridge tab (`src/bridge.js`) has three provider flows. Each is independent — a failure in one does not affect the others.

| Provider | Server module | Type | Key |
|---|---|---|---|
| NEAR Intents | `server/near.js` | Intent-based, deposit address | Optional API key (0.25% fee without) |
| Stargate V2 | `server/stargate.js` | On-chain, same-asset only | None |
| Aori | `server/aori.js` | EIP-712 intent orders | None |

## NEAR Intents (1Click API)

Flow:
1. `/api/near/quote` — returns a quote and a deposit address (valid ~10 min).
2. User's wallet switches to origin chain and sends exact amount to the deposit address. Native transfer for gas tokens; ERC-20 `transfer` (no approval) for ERC-20s.
3. Status polling: `/api/near/status?intentId=...` every 10s. States: `deposit → processing → done`. On failure, refund goes back to the user's wallet automatically.

**Important limits:**
- 1Click does not support Ink or Unichain — only Base, Ethereum, Optimism, Monad.
- Without an API key: 0.25% fee applies. Key goes in `server/.env` as `NEAR_INTENTS_API_KEY`.
- Deposit address expires in ~10 minutes. Show a countdown in the UI. If expired, re-fetch a new quote — do NOT reuse the address.
- `##NOT FOREVER##` — NEAR Intents is a temporary bridge integration; plan for replacement.

## Stargate V2

- Same-asset bridging only (e.g., USDC→USDC, ETH→ETH).
- Supported: Ethereum, Base, Optimism, Arbitrum, Avalanche, BNB.
- On-chain — no API, no server key. Quotes and txs built directly against Stargate contracts.
- CCTPV2 is planned as an additional fast stablecoin bridge — see `README.md` notes. When adding: create `server/cctp.js`, add `/api/cctp/quote` and `/api/cctp/status` routes in `server/index.js`, add `cctp` to relevant chain `sources[]` in `chains.js`.

## Aori

- Intent-based cross-chain orders using EIP-712 signatures.
- Supported: Ethereum, Base, Optimism, Arbitrum, Monad, BNB.
- Orders signed by the user's wallet — no custody.
- Module: `server/aori.js`.

## Gas refill (hot-protocol / drip-tools)

`README.md` notes hot-protocol SDK gas station is built in, with drip-tools/gas.zip integration pending. When wiring this in:
- Place the gas refill call **before** the bridge send, after the deposit address is returned.
- If the user has insufficient gas on the destination chain, call the refill endpoint first.
- Keep the refill logic in its own utility (`src/utils/gas.js`) — do not mix it into the bridge flow functions.

## Adding a bridge provider — checklist

1. Create `server/<provider>.js` with at minimum `getQuote()` and `getStatus()`.
2. Add Express routes in `server/index.js`: `/api/<provider>/quote` and `/api/<provider>/status`.
3. Add the provider UI flow in `src/bridge.js`.
4. Update `CHAINS.md` with new supported chain pairs.
5. If new chains are supported that are not in the swap engine, add them to `chains.js` too.

## Common mistakes

- Never reuse an expired NEAR deposit address. Always re-fetch.
- Stargate is same-asset only — do not offer cross-asset bridging through it.
- EIP-712 Aori orders must be signed by the user's wallet — do not sign server-side.
- Bridge status polling should back off on repeated errors, not hammer the endpoint.
