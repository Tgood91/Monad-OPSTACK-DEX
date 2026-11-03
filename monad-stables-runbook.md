# Monad Stables Basket — Funding Runbook

Settled 2026-10-17. One bridge in, native swaps on Monad, park in Aave. Amounts small by design.

## The basket

| Asset | Role | Notes |
|---|---|---|
| USDC | Bridge-in asset + core holding | Circle-native on Monad |
| USDT0 | Core holding | LayerZero OFT, canonical USDT on Monad |
| AUSD | Core holding | Agora, Monad-native, institutional backing |
| mUSD | Core holding | MetaMask/M0 dollar, T-bill backed |
| XAUt0 | Optional diversifier only | Tether omnichain gold — NOT a stable, moves with spot (~$4,160/oz) |

**On hold (his call):** young yield-bearers (earnAUSD, PT-AUSD, syrupUSDC) until liquidity matures. Maple/syrupUSDC additionally out — geo-blocked for him.

## Step 1 — Bridge USDC Base → Monad

- **Route:** Stargate **CCTP V2 Fast**. Re-verified 2026-10-16: Base USDC → Monad USDC routes fine (this corrected the earlier "nothing to wire" note).
- Base USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Monad USDC (Circle native): `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`
- Cost ~$0.02, ~8 seconds, 1:1 burn/mint — no wrapped IOU.
- Fallbacks already in his Bridge tab: LI.FI/Jumper, Aori, NEAR Intents, 1inch Fusion+ (quotes-only).

## Step 2 — Native swaps on Monad

- Use the DEX aggregator stack (KyberSwap verified working keyless; LI.FI, Aori, Fusion+ as backup). Everything swaps natively — no per-trade bridge legs.
- USDT0 (address his DEX already uses, verified in live quotes): `0xe7cd86e13AC4309349F30B3435a9d337750fC82D`
- AUSD / mUSD: resolve through aggregator token lists; verify the contract address on first use (his standing rule — especially after the gold-token scare).
- **Size discipline:** Monad pools are thin. Pull a live quote for each leg first and let the quote set the max comfortable clip. Keep trades small.
- Gas: his Monad wallet `0xBA397fAae1D5Fe10C0356f2e585bef34577ab111` holds ~20.44 MON — Monad fees are fractions of a cent, plenty of runway.

## Step 3 — Park in Aave Monad

Supply APYs from the 2026-10-17 check (rates move — re-check before sizing):

| Asset | Supply APY |
|---|---|
| USDC | 4.23% |
| USDT0 | 3.37% |
| AUSD | 3.41% |
| mUSD | 3.55% |

~$672M total supplied across the market — real liquidity, not farm emissions.

## Caveats (already agreed)

- XAUt0: can't redeem directly with Tether (wrapper-dependent), small per-chain supply, thin Monad liquidity. Quote first, keep it small, or skip — it breaks the stable-only logic.
- Nothing legitimate pays 15–25% on plain stables; the 5–8% band is what's real.
- Stable-only = impermanent loss near zero; the Aave yield is actually his.

## His remaining decisions

1. Basket split across the four stables (and whether XAUt0 gets a slot at all).
2. Clip sizes (quote-driven).
3. When to revisit the on-hold yield tokens.
