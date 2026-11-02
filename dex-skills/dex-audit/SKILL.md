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

- **Pre-sign simulation**: `eth_call` must run before every wallet signature request. If the simulation reverts, the tx must be blocked — never downgraded to a warning.
- **Approval spender**: Spender must come from `buildTx` return value. Audit any call to `approve()` and confirm the spender is not hardcoded.
- **Quote staleness**: Quotes are point-in-time. Simulation is the safety net. Document the max age a quote is used before re-fetch — current code does not enforce one. Consider a 30s expiry.
- **Fan-out error handling**: Confirm that a single adapter error (network timeout, API 500) does not kill the entire fan-out. Each adapter runs in its own `Promise.allSettled` slot.

### `server/index.js` and server modules

- **API key exposure**: `ONEINCH_API_KEY`, `ZERION_API_KEY`, `UNISWAP_API_KEY`, `CDP_API_KEY_ID/SECRET` must only appear in `server/.env`. Search for any of these strings in `src/` — they must not appear.
- **0x key**: `VITE_0X_API_KEY` is intentionally client-side (rate-limit key, origin-restricted). This is correct by design — do not move it to the server.
- **CORS**: Server should not set `Access-Control-Allow-Origin: *` in production. Confirm it's locked to the frontend origin.
- **Input validation**: `/api/*/quote` routes must validate `chainKey`, `tokenIn`, `tokenOut`, `amountIn` before passing to chain/adapter logic. Missing validation allows adapter crashes from malformed inputs.
- **TRUST_PROXY**: Set `app.set('trust proxy', 1)` only when running behind a known proxy (nginx). See `DEPLOY.md`.

### `VirtueFeeRouter.sol` / `VirtueAuditRegistry.sol`

- **Fee discount math**: Confirm virtue score → discount mapping cannot overflow or underflow. Scores should be clamped 0–100.
- **Registry write access**: Only authorized callers should write to `BUSHIDO_REGISTRY`. Check `onlyOwner` or equivalent on setter functions.
- **Reentrancy**: Any contract that transfers ETH or calls external contracts must use checks-effects-interactions or `ReentrancyGuard`.
- **Upgrade path**: If the contract is upgradeable, verify proxy admin is not the deployer EOA — use a multisig.

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
[ ] Fan-out uses Promise.allSettled (no single-failure kill)
[ ] Server routes validate all inputs
[ ] VirtueFeeRouter: no overflow in discount math
[ ] VirtueFeeRouter: setter access-controlled
[ ] NEAR deposit address expiry enforced in UI
[ ] No hardcoded spender addresses
[ ] CORS locked in production
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
