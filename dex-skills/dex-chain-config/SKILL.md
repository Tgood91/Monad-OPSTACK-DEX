---
name: dex-chain-config
description: Add, remove, or reconfigure chains and tokens in chains.js and config.js. Use when onboarding a new chain (e.g. adding CCTPV2 stablecoin bridging, a new OP Stack chain, or Monad testnet), updating RPC endpoints, or debugging chain-detection issues with AppKit / wagmi.
---

# Chain Configuration

## Files

| File | Responsibility |
|---|---|
| `src/dex/chains.js` | Chain + token + source registry — ground truth |
| `src/config.js` | AppKit (Reown) wallet setup, supported networks, modal theme |

## Supported chains (as of repo HEAD)

| Chain | chainId | Native | Notes |
|---|---|---|---|
| Base | 8453 | ETH | Full source set inc. Aerodrome, Coinbase CDP |
| Monad | 143 | MON | Aggregators only (LI.FI, KyberSwap, 1inch, 0x) |
| Optimism | 10 | ETH | Velodrome CL + v2, full aggregator set |
| Ink | 57073 | ETH | Velodrome Superchain; no KyberSwap/1inch/Velora/Zerion |
| Unichain | 130 | ETH | No Velodrome/Aerodrome; Uniswap + aggregators |

## Adding a new chain — checklist

1. **`src/dex/chains.js`** — add `CHAINS` entry:
   ```js
   newchain: {
     key: 'newchain',
     label: 'NewChain',
     chainId: <id>,
     native: 'ETH',
     color: '#hex',
     rpcs: ['https://...', 'https://...'],  // at least 2 fallbacks
     explorer: 'https://...',
     sources: ['lifi', 'kyberswap'],        // start with keyless aggregators
     tokens: [
       { symbol: 'ETH', address: '0x4200...0006', decimals: 18, isNative: true },
       { symbol: 'USDC', address: '0x...', decimals: 6 },
     ],
   }
   ```
2. **`src/config.js`** — import the wagmi/viem chain definition and add it to the AppKit `networks` array. For OP Stack chains, `viem/chains` usually has it; if not, define it manually.
3. **Reown cloud** — add the chainId to the project's allowed networks at cloud.reown.com. Without this, AppKit will refuse wallet connections on the new chain.
4. **Test**: connect a wallet, switch to the new chain, confirm `chainId` in the AppKit store matches.

## Updating RPC endpoints

Edit `rpcs[]` in `chains.js`. `_readProvider()` in `adapters.js` tries each in order with a 6s timeout — put fastest / most reliable first.

For Monad use `https://rpc.monad.xyz` as primary and `https://monad-mainnet.drpc.org` as fallback.

## Token addresses — common gotchas

- USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Circle native; NOT bridged USDC.e)
- USDC on Optimism: `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85`
- WMON (wrapped native) on Monad: `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`
- OP Stack native ETH sentinel: `0x4200000000000000000000000000000000000006` (WETH address used by most DEXes)

Always check the explorer before adding an address — bridged vs. native stablecoins have different addresses and liquidity.

## Monad-specific constraints

- Uniswap V3 uses a non-canonical `initCodeHash` on Monad — direct pool lookups revert. Do NOT add `uniswap` to `monad.sources`.
- Velora (ParaSwap) returns "Invalid network" for chainId 143 — keep it out.
- The app opens with `1 MON → USDC` prefilled on Monad — this is set in `src/main.js` `DEFAULT_STATE`.

## AppKit / wagmi chain detection

AppKit uses Reown's `createAppKit({ networks })`. Each network must be a wagmi-compatible chain object. If a wallet shows the wrong chain name or icon, the chain definition passed to AppKit is wrong — not the `CHAINS` registry. Both must stay in sync.

`src/config.js` also sets the Aave-style modal theme — do not change the theme in `chains.js`.
