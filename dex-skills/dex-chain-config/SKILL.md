---
name: dex-chain-config
description: Add, remove, or reconfigure chains and coins (src/dex/chains.js, src/config.js) and verify the data against the real chain. Use when onboarding a chain (BNB Chain and Avalanche were added this way), adding a coin to a picker, changing RPCs, or debugging chain detection or wrong decimals/addresses.
---

# Chain and coin configuration

The chain table is hand-written, and hand-copied data has already broken production twice (nine of fifteen Stargate token
addresses wrong; BNB Chain stablecoins given 6 decimals instead of 18). **Never add an address or decimals from memory.**

## Files

| File | Responsibility |
|---|---|
| `src/dex/chains.js` | `CHAINS` (chains, coins, which sources to ask), `SOURCE_META` (labels). The single source of truth. |
| `src/config.js` | Wallet (AppKit) networks: the `networks` array and `NETWORK_BY_KEY`. |
| `src/chain-menu.js`, `src/token-picker.js` | The chain menu and coin pickers read `CHAINS` automatically. |
| `src/bushido-swap.js` | Bushido panel: native-to-USDC pair per chain and `DEFAULT_AMOUNT` (a small first amount). |
| `src/ui/images.js` | Logos, keyed by chain key. |
| `test/chains-table.test.js` | Checks every chain (valid addresses, decimals, RPC count, sources). |
| `scripts/verify-chain-data.mjs` | Read-only live check of the table: `npm run verify:chains`. |

## Chains today (7)

Monad (143, default), Base (8453), Optimism (10), Ink (57073), Unichain (130), BNB Chain (`bsc`, 56), Avalanche (43114).
Ethereum is also a wallet network (for Merkl claims) but not a swap chain. Keys are lower-case and match the bridge's keys
(`bsc`, `avalanche`).

## Adding a chain: checklist

1. **Find working RPCs.** Try 5-6 public endpoints (`eth_chainId` must equal the chain ID; note latency). List at least
   two in `rpcs[]`, fastest first. Some "free" RPCs answer 403/525 or time out, so test them, do not assume.
2. **Verify every coin on its own chain** (symbol, decimals, contract code). Read decimals from the chain: they are not
   always 6 for stablecoins (BNB Chain USDC/USDT are 18). Addresses must pass the EIP-55 checksum.
3. **Check liquidity.** Price each coin from the wrapped native coin through KyberSwap at about $20 and about $200. Keep
   only coins under 0.5% loss at the small size and 0.25% at the large one. Retry a "no route": it can be a one-off.
4. **Add the entry to `CHAINS`** (`key`, `label`, `chainId`, `native`, `color`, `rpcs`, `explorer`, `sources`, `kyberName`,
   `tokens`). The first token is the native coin: `isNative: true`, **address = the wrapped-native contract** (WMON, WBNB, ...).
5. **Choose `sources` by testing each one** (see the harness below). Only list sources that returned a live quote.
   Chain-support maps exist in `src/dex/adapters.js` (`Zerion.supported`, `Uniswap.supported`, `Coinbase.supported`) and in
   `server/zerion.js`, `server/zerox.js` (`CHAINS` set). A source can be in a map yet still fail for your test wallet.
6. **Wallet network (`src/config.js`):** import the chain from `@reown/appkit/networks` (`bsc` and `avalanche` exist) or
   `defineChain({...})`; add it to `networks` and to `NETWORK_BY_KEY` under the **same key** as `CHAINS`. A missing entry
   makes "switch to this chain" fail.
7. **Bushido panel:** add a sensible first amount to `DEFAULT_AMOUNT` in `src/bushido-swap.js` (about a dollar or less).
8. **Tests and checks:** `npm test` (the table test runs on every chain), `npm run verify:chains -- --chain <key> --prices`.
   Add chain-specific assertions for anything surprising (like 18-decimal stablecoins) to `test/chains-table.test.js`.
9. **Docs:** README (chain list and sources table), `CHAINS.md`, CHANGELOG entry (what, why, and what was not verified).
10. **After the deploy:** open the live site on a phone-sized screen, switch to the chain from the menu, enter an amount,
    and confirm quotes arrive. A real swap needs a wallet holding the native coin: say if it was not done.

## Testing a source on a new chain (the app's own code, against the live server)

Run `src/dex/adapters.js` in Node with a `fetch` shim that sends relative `/api/...` calls to the live server, then call
`ADAPTERS[source].quote(chainKey, nativeToken, usdcToken, amountWei, wallet, 50)` for each listed source and compare the
outputs. Sources that agree within about 0.5% are healthy. Expect: `fusion` cannot sell a native coin; a keyed source can
fail for a wallet with no funds. Keep the harness out of the repo.

## Adding a coin to an existing chain

Same as steps 2-3, then add one line to `tokens` (keep MON/USDC first on Monad: the app's defaults use index 0 and 1).
Use the on-chain symbol where possible (`USDt` on Avalanche). Add it to the chain-specific test if it has a gotcha.

## Monad specifics

- Aggregators only (LI.FI, KyberSwap, 1inch, 0x; Fusion for token sells). No Uniswap: its factory uses a non-standard pool
  init-code hash, so direct pool calls revert. Velora rejects chain 143 ("Invalid network").
- `MON` is the native coin with the **WMON** contract as its address; `WMON` is also listed as an ordinary token. Picking MON
  and WMON together is blocked with an explanation (they are the same value; wrapping is not built into the swap).
- The Monad list was screened against Monad's official token list (`monad-crypto/token-list` on GitHub): of 125 tokens, 124
  matched on-chain, only 63 had any KyberSwap route, and many showed impossible prices (no real liquidity). Tokenised bonds,
  funds and vault shares are left out on purpose (they can restrict who may hold them).
- Gas is charged by gas limit on Monad (gas used equals gas limit), so a transaction using its whole limit is not out of gas.

## Gotchas

- **Decimals:** BNB Chain USDC and USDT are 18. A wrong value sends or quotes an amount off by many orders of magnitude.
- **Checksums:** a mixed-case address with a wrong checksum is rejected by ethers in the browser (balance and approval fail)
  even though raw RPC calls work. This is how the Stargate table failed silently.
- **Explorers** (BscScan, Snowtrace, MonadVision) return 403 to automated requests. Check their links by hand.
- **Explorer verification:** Monadscan may show a contract as unverified while Sourcify (BlockVision's Monad instance:
  `https://sourcify-api-monad.blockvision.org/files/143/<address>`) has the source.
- **Reown dashboard:** if wallet connection is refused on a new chain, check the project's allowed networks at
  cloud.reown.com (not verified for the newest chains here).
- Ink currently lists a single RPC (a known gap): `npm run verify:chains` notes it.
