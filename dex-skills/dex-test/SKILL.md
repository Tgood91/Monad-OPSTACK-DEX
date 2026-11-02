---
name: dex-test
description: Write and run tests for the DEX — adapter unit tests, engine integration tests, quote fan-out mocks, and Foundry/Hardhat contract tests for VirtueFeeRouter. Use when adding a new adapter, changing slippage logic, or preparing for a contract deploy.
---

# DEX Testing

## Test layers

| Layer | Tool | What to test |
|---|---|---|
| Adapter unit | Vitest / Jest | `quote()` return shape, `buildTx()` output fields, null on no-route |
| Engine integration | Vitest + msw mocks | Fan-out, timeout handling, ranking, simulation check |
| Contract | Foundry (`forge test`) | VirtueFeeRouter discount math, registry access control |
| E2E (optional) | Playwright | Full swap flow on a fork |

## Adapter unit tests

Every adapter must be tested for:

1. **Happy path** — `quote()` returns a `Quote` with `source`, `amountOut: bigint`, `raw`.
2. **No-route** — `quote()` returns `null` (not throws) when the pool/route doesn't exist.
3. **buildTx fields** — returns `{ to, data, value, spender }`. All four fields must be present.
4. **Native token** — `value === amountInWei` and no allowance call when `tokenIn.isNative`.

```js
// Example test structure (Vitest)
import { Aerodrome } from '../src/dex/adapters.js';

vi.mock('ethers', () => ({ /* mock provider + contract */ }));

test('Aerodrome quote returns null when no pool', async () => {
  // mock getAmountsOut to return 0
  const result = await Aerodrome.quote('base', tokenIn, tokenOut, 1000000n);
  expect(result).toBeNull();
});

test('Aerodrome buildTx returns all required fields', async () => {
  const tx = await Aerodrome.buildTx(mockQuote, wallet, 50, mockSigner);
  expect(tx).toHaveProperty('to');
  expect(tx).toHaveProperty('data');
  expect(tx).toHaveProperty('value');
  expect(tx).toHaveProperty('spender');
});
```

## Engine integration tests

Key scenarios:

- **Fan-out**: all adapter `quote()` calls run in parallel; results are returned sorted by `amountOut` descending.
- **Timeout**: an adapter that hangs past `QUOTE_TIMEOUT_MS` (8000ms) is dropped; others still return.
- **Single adapter error**: one adapter throws — the others still return (verify `Promise.allSettled` behavior).
- **Simulation block**: mock `eth_call` to revert — confirm `executeSwap` throws before sending the signature request.
- **Allowance skip**: when `tokenIn.isNative`, confirm no `allowance` or `approve` call runs.

Mock the RPC and external API calls with `msw` or manual `vi.mock`. Do not make real network calls in unit/integration tests.

## Contract tests (Foundry)

```bash
cd contracts  # or repo root if forge is set up there
forge test -vv
```

### VirtueFeeRouter test cases

```solidity
// VirtueFeeRouter.t.sol
function test_FeeDiscount_MaxVirtue() public { ... }   // score=100 → max discount
function test_FeeDiscount_ZeroVirtue() public { ... }  // score=0 → no discount
function test_FeeDiscount_Overflow() public { ... }    // score>100 → clamped
function test_Registry_OnlyOwner() public { ... }      // non-owner write reverts
function test_Registry_SetAndGet() public { ... }      // round-trip
```

Run with fork for mainnet contract state:
```bash
forge test --fork-url https://developer-access-mainnet.base.org -vv
```

## Running quote tests against live RPCs (dev only)

```bash
# From repo root — quick quote check for a specific chain
node -e "
import('./src/dex/adapters.js').then(async ({ Aerodrome }) => {
  const { CHAINS } = await import('./src/dex/chains.js');
  // ... test with real RPC
})
"
```

Only run against live RPCs manually — never in CI. CI uses mocks.

## CI setup (`.github/workflows`)

The repo has `npm-publish-github-packages.yml`. Add a test job:

```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '20' }
    - run: npm ci
    - run: npm test
    - run: cd contracts && forge test  # if Foundry is installed
```

## Common test mistakes

- Do not test with `amountOut: 0n` as a "valid" quote — the engine filters these out. Test the null path instead.
- When mocking `ethers.Contract`, mock both the factory method and the individual ABI calls.
- Slippage math must use BigInt: `amountOut * 9950n / 10000n` not `amountOut * 0.995`.
- Contract tests should test revert cases, not just happy paths.
