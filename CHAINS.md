# Chain Reference

EVM chain IDs and LayerZero V2 endpoint IDs for all chains in this DEX.

## Swap chains

| Chain | EVM Chain ID | Native | LayerZero EID |
|-------|-------------|--------|---------------|
| Celo | 42220 | CELO | — |
| Optimism | 10 | ETH | 30111 |
| Ink | 57073 | ETH | — |
| Base | 8453 | ETH | 30184 |
| Unichain | 130 | ETH | 30320 |

## Bridge chains

| Chain | EVM Chain ID | Native | LayerZero EID | NEAR Intents | Stargate | Aori |
|-------|-------------|--------|---------------|--------------|----------|------|
| Ethereum | 1 | ETH | 30101 | ✓ | ✓ | ✓ |
| Base | 8453 | ETH | 30184 | ✓ | ✓ | ✓ |
| Optimism | 10 | ETH | 30111 | ✓ | ✓ | ✓ |
| Monad | 143 | MON | 30390 | ✓ | OFT-only* | ✓ |
| Arbitrum | 42161 | ETH | 30110 | — | ✓ | ✓ |
| Avalanche | 43114 | AVAX | 30106 | — | ✓ | — |
| BNB Chain | 56 | BNB | 30102 | — | ✓ | ✓ |

\* Stargate pool contracts don't list Monad; its path is via USDT0/WBTC LayerZero OFTs (not yet wired).

## Notes

- **EVM Chain ID**: used for wallet `chainId`, RPC calls, and chain switching.
- **LayerZero EID**: used by Stargate/OF T `sendParam.dstEid` and cross-chain messaging.
  The LayerZero EndpointV2 contract lives at `0x1a44076050125825900e736c501f859c50fE728c` on every supported chain.
- **NEAR Intents** chain names (1Click API): `base`, `eth`, `op`, `monad`.
- **Aori** chain keys: `base`, `ethereum`, `optimism`, `monad`, `arbitrum`, `bsc`.
