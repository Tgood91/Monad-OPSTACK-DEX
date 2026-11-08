---
name: dex-audit
description: Audit the DEX codebase for security issues — slippage manipulation, approval/allowance bugs, simulation bypass, private key exposure, oracle manipulation, and VirtueFeeRouter contract vulnerabilities. Use before any mainnet deploy or when reviewing a PR that touches adapters, engine, contracts, or server routes.
---

# DEX Security Audit

## Audit scope by file

### `src/dex/adapters.js`

- **Spender address**: `buildTx` must return `spender` from the real built transaction, never hardcoded. Verify `allowance` is checked against the returned spender, not a constant.
- **Slippage**: `minOut = amountOut * (10000 - slippageBps) / 10000n`. Confirm integer arithmetic — BigInt division truncates, which is safe. Confirm `slippageBps` is bounded (e.g., max 500 = 5%).
- **Native token path**: When `tokenIn.isNative`, `value` must equal `amountInWei` and no allowance step should run. Verify both.
- **Return null, not throw**: Adapters must return `null` on no-route, not throw. A thrown error in a quote fan-out silently kills that adapter's result without surfacing why.
- **RPC timeout**: `_readProvider` has a 6s timeout per RPC. Confirm there's no unbounded `await` on any contract call — wrap in `Promise.race` if needed.

### `src/dex/engine.js`

- **Pre-sign simulation** (done in `src/main.js`, `src/BushidoPanels.jsx` and the Dojo buttons through `src/simulate.js`; the engine only quotes and builds): a dry run must pass before every wallet signature request. A real revert blocks; if nothing can answer, nothing is sent and the message says so. Never downgrade a revert to a warning.
- **Approval spender**: Spender must come from `buildTx` return value. Audit any call to `approve()` and confirm the spender is not hardcoded.
- **Quote staleness**: Quotes are point-in-time. Simulation is the safety net. Document the max age a quote is used before re-fetch — current code does not enforce one. Consider a 30s expiry.
- **Fan-out error handling**: Confirm that a single adapter error (network timeout, API 500) does not kill the entire fan-out. Each source runs inside its own `try/catch` in `quoteAll` and reports its reason inline; a temporary failure is retried once and a failing source is paused (`src/dex/resilience.js`).

### `server/index.js` and server modules

- **API key exposure**: `ONEINCH_API_KEY`, `ZERION_API_KEY`, `UNISWAP_API_KEY`, `CDP_API_KEY_ID/SECRET` must only appear in `server/.env`. Search for any of these strings in `src/` — they must not appear.
- **0x key**: `ZEROX_API_KEY` lives on the server (`server/zerox.js`; browsers cannot call 0x v2). `VITE_0X_API_KEY` is only read as an old fallback name. Any `VITE_*` secret ships to every visitor: flag it.
- **CORS**: Server should not set `Access-Control-Allow-Origin: *` in production. Confirm it's locked to the frontend origin.
- **Input validation**: `/api/*/quote` routes must validate `chainKey`, `tokenIn`, `tokenOut`, `amountIn` before passing to chain/adapter logic. Missing validation allows adapter crashes from malformed inputs.
- **TRUST_PROXY**: must equal the number of proxies in front (`3` on Render: Cloudflare, Render's edge, Render's proxy). Too low: every visitor shares one address (limits and the faucet's per-visitor rule break). Too high: addresses can be spoofed. Check `/api/health` -> `proxy.yourIp` is the visitor's own address.

### `VirtueFeeRouter.sol` / `VirtueAuditRegistry.sol`

- **Fee discount math**: Confirm virtue score → discount mapping cannot overflow or underflow. Scores should be clamped 0–100.
- **Registry write access**: Only authorized callers should write to `BUSHIDO_REGISTRY`. Check `onlyOwner` or equivalent on setter functions.
- **Reentrancy**: Any contract that transfers ETH or calls external contracts must use checks-effects-interactions or `ReentrancyGuard`.
- **Upgrade path**: If the contract is upgradeable, verify proxy admin is not the deployer EOA — use a multisig.

### `server/faucet.js` and `server/perks.js`

- **Faucet key blast radius**: `FAUCET_PRIVATE_KEY` is the one key the server holds. It must be a dedicated wallet with a few
  MON; losing it must cost only that balance. Eligibility is on-chain (nonce 0 and balance under the minimum), the sends are
  serialized inside one queue (no double-claim race), and per-visitor and daily limits sit on top. Confirm the eligibility check
  runs inside the queue, not before it.
- **Per-visitor limit** depends on `TRUST_PROXY` being right (it is skipped for private addresses).
- **Perk tokens**: a signed claim (time-stamped, 5 minutes) is verified, the pass is checked on Monad by the server, and an
  HMAC token (7 days) only raises a request limit. Check: a forged or edited token is rejected; a stale claim is rejected;
  without `PERKS_SECRET` tokens die on restart (acceptable); a revoked pass keeps perks until its token expires.

### `server/bushido.js`

- **Seykota signal**: EMA12/26 on hourly ETH-USD. Confirm the data source (price feed) is from a trusted oracle, not user-controlled input.
- **Virtue gate**: If the Bushido tab gates features by virtue score, confirm the score is read from the on-chain `BUSHIDO_REGISTRY`, not from a UI-side variable that can be manipulated.

## Audit checklist

```
[ ] No API keys in src/ or committed .env files
[ ] buildTx always returns spender from the real tx
[ ] eth_call simulation runs before every sign prompt
[ ] Slippage is capped and applied with BigInt math
[ ] Native token path skips allowance check
[ ] One failing source never kills a quote batch (per-source try/catch)
[ ] Server routes validate all inputs
[ ] VirtueFeeRouter: no overflow in discount math
[ ] VirtueFeeRouter: setter access-controlled
[ ] NEAR deposit address expiry enforced in UI
[ ] No hardcoded spender addresses
[ ] CORS locked in production
[ ] Chain table verified against the chains (npm run verify:chains): addresses valid, decimals right (BNB stables are 18)
[ ] Stargate table: every token address equals its pool's token(); test/stargate-table.test.js passes
[ ] Faucet key is a fresh dedicated wallet (not the owner's, not a contract owner, not a Safe), holds only a few MON
[ ] Reads (balances, dry runs) do not depend on the wallet provider (public RPC first)
[ ] Errors that are glitches show amber and retry; red only for confirmed problems; ops log "high" only for real reverts
```

## Running a quick grep audit

```bash
# Keys in frontend
grep -r "ONEINCH\|ZERION_API\|UNISWAP_API\|CDP_API" src/

# Hardcoded spender addresses (flag for review)
grep -r "approve\|spender" src/dex/

# Simulation bypass patterns
grep -r "eth_call\|simulate\|staticCall" src/dex/engine.js
```
