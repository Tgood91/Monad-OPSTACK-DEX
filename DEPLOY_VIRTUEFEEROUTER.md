# VirtueFeeRouter — Deployment Guide

Everything you need to deploy `VirtueFeeRouter.sol` to Base mainnet, in order.

## What you're deploying

| Item | Value |
|---|---|
| Contract | `VirtueFeeRouter` (`contracts/VirtueFeeRouter.sol`) |
| Network | Base mainnet (chain ID 8453) |
| Constructor | `(address admin, address recorder)` |
| Fee params after deploy | base=100bps, maxDiscount=50bps, threshold=55 |
| Compiler | solc 0.8.37, optimizer 200 runs |

**Roles:** `admin` gets `DEFAULT_ADMIN_ROLE` + `GOVERNOR_ROLE`. `recorder` gets `RECORDER_ROLE`
(can call `recordVirtueAudit`). Use your Safe for both unless you have a separate
backend address doing the recording.

## Files in this repo

| Path | What it is |
|---|---|
| `contracts/VirtueFeeRouter.sol` | The contract source |
| `deploy-virtuefeerouter.js` | Interactive deploy script (prompts for everything) |
| `verify-virtuefeerouter/standard-json-input.json` | Basescan verification input (solc 0.8.37, optimizer 200) |
| `verify-virtuefeerouter/abi.json` | Contract ABI |

---

## Step 1 — Clone the repo

```bash
git clone https://github.com/Tgood91/Monad-OPSTACK-DEX.git
cd Monad-OPSTACK-DEX/dex-app/server
```

## Step 2 — Install dependencies

```bash
npm install ethers solc @openzeppelin/contracts
```

Requires Node.js 20+.

## Step 3 — Fund your deployer

The deployer wallet needs a small amount of ETH on Base for gas (~$1-2 worth is plenty;
the contract is ~3,100 bytes).

## Step 4 — Run the deploy script

```bash
node ../../deploy-virtuefeerouter.js
```

Answer the prompts as they appear:

| Prompt | What to enter |
|---|---|
| `Deployer private key` | Your deployer key (hidden as you type, never logged) |
| `Admin address` | Your Safe address |
| `Recorder address` | Your Safe address (or press Enter to reuse admin) |
| `Base RPC` | Press Enter (uses `https://mainnet.base.org`) |
| `Deploy?` | Type `y` |
| `Set custom fee parameters?` | Type `y` |
| `baseIntegratorFeeBps` | Press Enter (pre-filled `100`) |
| `maxDiscountBps` | Press Enter (pre-filled `50`) |
| `requiredHonorThreshold` | Press Enter (pre-filled `55`) |

The script prints the deployed address and a Basescan link, then verifies the
roles on-chain.

> **If your Safe is the admin:** the deployer EOA cannot call `setFeeParameters`
> (only `GOVERNOR_ROLE` can). The script detects this and tells you to run it
> as a Safe transaction instead: in the Safe UI, contract interaction on the
> deployed address → `setFeeParameters(100, 50, 55)` → 2-of-3 sign → execute.

## Step 5 — Verify on Basescan

1. Go to the contract on Basescan: `https://basescan.org/address/<DEPLOYED_ADDRESS>`
2. Click **Contract → Verify and Publish**
3. Compiler: **v0.8.37**, Optimization: **Yes, 200 runs**
4. Verification method: **Standard JSON Input**
5. Upload `verify-virtuefeerouter/standard-json-input.json`
6. Constructor arguments: the ABI-encoded `(admin, recorder)` — the deploy
   script prints the deployment tx; copy the trailing calldata after the
   bytecode, or re-encode with:
   ```bash
   node -e "const {ethers}=require('ethers'); console.log(new ethers.AbiCoder().encode(['address','address'],['<ADMIN>','<RECORDER>']).slice(2))"
   ```

## Step 6 — Sanity checks (read-only, no gas)

On Basescan's **Read Contract** tab, or via cast/ethers:

| Check | Expected |
|---|---|
| `hasRole(DEFAULT_ADMIN_ROLE, <admin>)` | `true` |
| `hasRole(GOVERNOR_ROLE, <admin>)` | `true` |
| `hasRole(RECORDER_ROLE, <recorder>)` | `true` |
| `baseIntegratorFeeBps()` | `100` |
| `maxDiscountBps()` | `50` |
| `requiredHonorThreshold()` | `55` |
| `calculateDynamicFee(<unregistered>)` | `100` (base fee, no discount) |

## Quick reference — fee math

- Unranked or below threshold → pays `baseIntegratorFeeBps` (100 = 1.00%)
- Honor 80 (threshold 55) → discount scales linearly up to `maxDiscountBps` (50)
- Honor 100 → full 50bps discount → pays 50bps (0.50%)
- `validateIntentExecution` reverts unless audit passed AND honor ≥ 55
