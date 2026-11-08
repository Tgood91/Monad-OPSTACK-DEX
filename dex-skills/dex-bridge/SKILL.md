---
name: dex-bridge
description: Build, debug, or extend the cross-chain bridge tab — NEAR Intents, Stargate V2, and Aori flows in src/bridge.js and server/near.js / server/stargate.js / server/aori.js. Use when fixing bridge quote failures, adding CCTPV2, debugging deposit-address expiry, or wiring in drip-tools gas refill.
---

# Bridge

## Architecture

The bridge tab (`src/bridge.js`) has three provider flows. Each is independent — a failure in one does not affect the others.

| Provider | Server module | Type | Key |
|---|---|---|---|
| NEAR Intents | `server/near.js` | Intent-based, deposit address | No key in the env: a vault surrogate when available, otherwise keyless (0.25% fee) |
| Stargate V2 | `server/stargate.js` | On-chain, same-asset only | None |
| Aori | `server/aori.js` | EIP-712 intent orders | None |

## NEAR Intents (1Click API)

Flow:
1. `/api/near/quote` is a dry preview. `/api/near/intent` creates the real intent and returns a **deposit address** with a
   **deadline** (shown on screen as "Send before ...").
2. **Review before you pay** (`src/bridge-deposit.js`, `src/bridge-deposit-ui.js`): the browser asks **NEAR's own status
   service** (`https://1click.chaindefuser.com/v0/status?depositAddress=...`), not our server, and confirms NEAR recorded
   the user's wallet as receiver and refund address, for the chosen amount, as a live quote. The address is not shown, and the
   Send button stays disabled, until that passes. A mismatch is red (it involves money); a failure to reach NEAR is retried.
3. The wallet switches to the origin chain and sends the exact amount to the deposit address: a native transfer for gas
   coins, an ERC-20 `transfer` (no approval) otherwise.
4. Status: `/api/near/status?depositAddress=...` every 10s. States: deposit -> processing -> done. A failed bridge refunds to
   the same wallet.

**Important limits:**
- 1Click sends from Base, Ethereum, Optimism and Monad. BNB Chain, Avalanche, Polygon, Scroll, X Layer and ADI are delivered
  over HOT Protocol's bridge and used as **destinations** (the Get gas feature, `src/gas.js`). Ink and Unichain are not listed.
- NEAR can set temporary swap minimums (BNB Chain needed about $1,000 on 2026-11-05 and on 2026-11-08). The quote error says so.
- NEAR can also quote **same-chain** swaps (~40-50 s, about 0.27% on Base/Avalanche), but its token list is small (3 coins on
  Monad, none on Ink/Unichain), so it is not used as a general swap source.
- Never reuse an expired deposit address; fetch a new quote.

## Stargate V2

- Same-asset bridging only (e.g., USDC→USDC, ETH→ETH).
- Supported: Ethereum, Base, Optimism, Arbitrum, Avalanche, BNB.
- On-chain: no API, no server key. Quotes and txs are built against the Stargate pool contracts through RPC.
- **The pool/token table in `server/stargate.js` is hand-copied and has been wrong before.** Each token address must equal
  that pool's own `token()` on-chain and pass the EIP-55 checksum; **BNB Chain USDC and USDT are 18 decimals** (the table's
  `decimals` field). `test/stargate-table.test.js` guards both. The browser uses the token address for balances and approvals,
  so a bad address breaks bridging from that chain while quotes (which use the pool) still look fine.
- USDT routes that touch Optimism or Arbitrum revert inside Stargate's contracts (cause unconfirmed); USDC and native routes
  work on all six chains. The health strip probes only Base routes, so test other chains by hand.
- CCTPV2 is planned as an additional fast stablecoin bridge — see `README.md` notes. When adding: create `server/cctp.js`, add `/api/cctp/quote` and `/api/cctp/status` routes in `server/index.js`, add `cctp` to relevant chain `sources[]` in `chains.js`.

## Aori

- Intent-based cross-chain orders using EIP-712 signatures.
- Supported: Ethereum, Base, Optimism, Arbitrum, Monad, BNB.
- Orders signed by the user's wallet — no custody.
- Module: `server/aori.js`. Its quote service has been returning HTTP 500 (a provider outage): the health strip shows it amber, then red after 3 confirmed checks.

## Route health strip (`server/bridge-health.js`)

Probes each provider with a real 1-USDC quote on canary routes. **Red only when confirmed:** a failed check is retried once; if it
still fails the route is amber ("unstable, check 1 of 3, may be a glitch"); it turns red only after 3 failed checks in a row, at
least 60 s apart. "Unknown" (not configured) is never counted. When adding a provider, add its canary route there.

## Gas refill

"Get gas" is built (`src/gas.js`): it fills the Bridge form (NEAR Intents, USDC -> the destination's native coin) and the normal
bridge flow does the rest. Destinations are the EVM chains NEAR delivers over HOT's bridge (`NEAR_CHAINS` in `server/near.js`).

## Adding a bridge provider — checklist

1. Create `server/<provider>.js` with at minimum `getQuote()` and `getStatus()`.
2. Add Express routes in `server/index.js`: `/api/<provider>/quote` and `/api/<provider>/status`.
3. Add the provider UI flow in `src/bridge.js`.
4. Update `CHAINS.md` with new supported chain pairs.
5. If new chains are supported that are not in the swap engine, add them to `chains.js` too.

## Common mistakes

- Never reuse an expired NEAR deposit address. Always re-fetch. Never show the address before the independent check passes.
- Never hand-copy a token address or decimals: read them from the chain (`npm run verify:chains`, and `pool.token()` for Stargate).
- Stargate is same-asset only — do not offer cross-asset bridging through it.
- EIP-712 Aori orders must be signed by the user's wallet — do not sign server-side.
- Bridge status polling should back off on repeated errors, not hammer the endpoint.
