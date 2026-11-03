# OP Stack Test Results — 2026-10-07

Live quote tests: 0.01 native → stablecoin on each chain.
Key: ✅ live quote returned | ⚠️ listed but no route | ❌ not supported | 🔑 needs API key (not tested)

## Same-chain swaps

| Chain | ID | KyberSwap | LI.FI | Velora | 1inch 🔑 | 0x 🔑 | OpenOcean | Velodrome |
|---|---|---|---|---|---|---|---|
| Optimism | 10 | ✅ | ✅ | ✅ | ✅ docs | ✅ docs | ✅ docs |
| Base | 8453 | ✅ | ✅ | ✅ | ✅ docs | ✅ docs | ✅ docs |
| Unichain | 130 | ✅ | ✅ | ✅ | ✅ docs | ✅ docs | ✅ docs |
| Mode | 34443 | ❌ | ✅ | ❌ | ❌ | ✅ docs | ✅ docs |
| Ink | 57073 | ❌ | ✅ | ❌ | ❌ | ✅ docs | ❌ |
| World Chain | 480 | ❌ | ✅ | ❌ | ❌ | ✅ docs | ❌ |
| Soneium | 1868 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Lisk | 1135 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| BOB | 60808 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Blast | 81457 | ❌ inactive | ✅ | ❌ | ❌ | docs vary | ✅ docs |
| Fraxtal | 252 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Celo | 42220 | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ | Velodrome (no liquidity yet) |
| Robinhood | 4663 | ✅ registry | ✅ | ✅ API list | ❌ | ✅ docs | ❌ | — |

## Cross-chain / intents

| Protocol | OP chains | Live test |
|---|---|---|
| NEAR Intents 1Click | Base, Optimism | API live, request format validated; "No liquidity available" for OP→Base test pair at test time (solver-dependent) |
| LI.FI (bridge) | all chains in table above | ✅ tested same-chain; cross-chain uses same /quote with different fromChain/toChain |
| Jumper | = LI.FI backend | same coverage as LI.FI |
| LiquidMesh | Base only (per liquidmesh.io) | API exists (Quote/Flash/Boost); needs API key + integration docs |

## Verified quote outputs (0.01 ETH → stable)

- KyberSwap OP: 25.652983 USDT | Base: 25.657043 USDC | Unichain: 25.645618 USDC
- Velora OP: 25.650158 USDT | Base: 25.653416 USDC | Unichain: 25.641664 USDC
- LI.FI OP: ~25.57 | Base: ~25.53 | Unichain: ~25.56 | Mode: ~25.50 | Ink: ~25.65 | WorldChain: ~25.59 | Soneium: ~25.52 | Lisk: ~25.33 | BOB: ~25.74 | Blast: ~25.43 | Fraxtal: ✅ via FRAX

## Velodrome on Celo — verified 2026-10-07

- Velodrome's official Superchain deployment includes Celo (v1.1), confirmed via github.com/velodrome-finance/superchain-contracts
- Celo contract addresses (from official deployment-addresses/celo.json):
  - v2 PoolFactory: `0x31832f2a97Fd20664D76Cc421207669b55CE4BC0`
  - v2 Router: `0x3a63171DD9BebF4D07BC782FECC7eb0b890C2A45`
  - Slipstream CL Quoter: `0x426ef6F781bA0Fbc1A7b0D3399D6FA6548464C85` (same address on all Superchain chains)
  - Slipstream CL PoolFactory: `0x718E46d0962A66942E233760a8bd6038Ce54EdCD`
  - Slipstream SwapRouter: `0xc58C8aC11b62D9f649Ba6EBA19d6b70FcbBb2E80`
- **Wired in multichain.html** (2026-10-07) as quote source for Celo, Optimism, Ink. OP uses original deployment (CL Quoter `0xAd432b2ca49965266133F2bd4c17dc1Ec12f5DEB`, v2 Router `0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858`); Ink uses Superchain addresses.
- **Live pool discovery:** OP has WETH/USDC CL (ts=50) + v2 pools; Celo has WCELO/USDC v2 volatile pool (`0x6AB6e5e0CdC882B85838a3a829c9caE803730045`) but quote returned dust (no real liquidity); Ink has no WETH/USDC pools yet. Adapter tries CL (ts 1/10/50/200) + v2 (stable/volatile), picks best, shows "no liquidity" gracefully.
- No public REST API; integration is on-chain via Quoter `quoteExactInputSingle(address,address,int24,uint256,uint160)` (selector `0xce7fc682`).
- Velodrome also supports these OP Stack chains with the same contract addresses: Optimism, Mode, Lisk, Fraxtal, Ink, Soneium, Unichain (+ Metal, Superseed, Swell).
- Recommendation: wire Velodrome as Celo's quote source in the UI (contracts ready, quoting works via eth_call), but expect "no liquidity" until pools launch. LI.FI remains the only Celo source with any route today.

## Notes

- Velora = ParaSwap rebrand (confirmed via velora.xyz). Same protocol, one integration.
- Velora Unichain /prices requires explicit srcDecimals/destDecimals params.
- Celo: LI.FI lists chain + tokens but route generation failed for CELO→USDC (thin liquidity).
- Zora: removed per request 2026-10-07 — no protocol in this set supported it.
- 1inch/0x need API keys for live testing; chain support taken from official docs.
- OpenOcean Cloudflare-blocked from server; chain support from docs/SDK.
- NEAR Intents is cross-chain only (deposit → solver fills on destination); no same-chain mode.
