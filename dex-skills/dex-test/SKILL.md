---
name: dex-test
description: Write and run tests for the DEX — adapter unit tests, engine integration tests, quote fan-out mocks, and Foundry/Hardhat contract tests for VirtueFeeRouter. Use when adding a new adapter, changing slippage logic, or preparing for a contract deploy.
---

# DEX Testing

## Test layers

| Layer | Tool | What to test |
|---|---|---|
| Adapter unit | `node:test` (`npm test`) | `quote()` return shape, `buildTx()` output fields, null on no-route |
| Engine integration | `node:test` with injected fakes | Fan-out, timeout handling, ranking |
| Contract | Foundry (`forge test`) | VirtueFeeRouter discount math, registry access control |
| E2E (optional) | Playwright | Full swap flow on a fork |

## How tests are written in this repo (the real conventions)

- **Runner:** Node's built-in `node:test` with `assert/strict`: `npm test` runs every `test/*.test.js`. No Vitest, Jest or msw.
- **No network, no wallet, no DOM.** Logic that matters is kept in pure modules and tested with injected fakes:
  `fetchImpl`, `sleep`, `now` and `storage` parameters, fake providers (`{ call: async () => ... }`), and plain objects
  standing in for `localStorage`. Examples: `test/simulate.test.js`, `test/faucet-button.test.js`, `test/perks.test.js`,
  `test/bridge-health.test.js`.
- **One file per area**, named for the module. When a bug reaches production, add a test that pins it (for example
  `test/stargate-table.test.js` for the Stargate address/decimals bug, `test/page-structure.test.js` for the stray `</div>`).
- **Data tables get table tests** (`test/chains-table.test.js`, `test/monad-tokens.test.js`): valid checksummed addresses,
  decimals, no duplicates. These catch typos offline; `npm run verify:chains` checks the same table against the real chains.
- **New files must be added to the Prettier lists** (`format`, `format:check`) in `package.json`.
- A passing browser check is done by hand outside the repo (phone-sized and desktop screens, a stand-in wallet); do not commit
  test harnesses.

## Adapter unit tests

Every adapter must be tested for:

1. **Happy path** — `quote()` returns a `Quote` with `source`, `amountOut: bigint`, `raw`.
2. **No-route** — `quote()` returns `null` (not throws) when the pool/route doesn't exist.
3. **buildTx fields** — returns `{ to, data, value, spender }`. All four fields must be present.
4. **Native token** — `value === amountInWei` and no allowance call when `tokenIn.isNative`.

```js
// Example test structure (node:test, a fake fetch instead of the network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation } from '../src/simulate.js';

const refuse = () => ({ call: async () => { throw new Error('Call failed'); } });
const fine = () => ({ call: async () => '0x' });

test('a wallet that refuses eth_call falls through to the next provider', async () => {
  const r = await runSimulation([refuse(), fine()], { to: '0x1', data: '0x', from: '0x2' });
  assert.equal(r.ok, true);
});

test('a real revert is believed and blocks', async () => {
  const reverts = { call: async () => { throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' }); } };
  const r = await runSimulation([reverts, fine()], { to: '0x1', data: '0x', from: '0x2' });
  assert.deepEqual([r.ok, r.reverted], [false, true]);
});
```

## Engine integration tests

Key scenarios:

- **Fan-out**: all adapter `quote()` calls run in parallel; results are returned sorted by `amountOut` descending.
- **Timeout**: an adapter that hangs past `QUOTE_TIMEOUT_MS` (8000ms) is dropped; others still return.
- **Single adapter error**: one adapter throws — the others still return (verify `Promise.allSettled` behavior).
- **Simulation block**: give `runSimulation` a fake provider that reverts and confirm the result is `ok: false, reverted: true`; a provider that only refuses ("Call failed") must fall through to the next one (`test/simulate.test.js`).
- **Allowance skip**: when `tokenIn.isNative`, confirm no `allowance` or `approve` call runs.

Inject fake `fetch` and provider objects. Do not make real network calls in unit/integration tests.

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

The workflow `npm-publish-github-packages.yml` already runs `npm ci`, `npm test` and `npm run build` on Node 20 for every pull request (its publish job is skipped). A job like this one is what it looks like:

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
