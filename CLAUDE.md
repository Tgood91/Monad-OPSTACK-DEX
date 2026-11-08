# CLAUDE.md: working in the Bushido-dApp repo

Read this first. It is the short version of how this project works and what has already gone wrong. Details live in
[README.md](README.md) (what the app does), [CHANGELOG.md](CHANGELOG.md) (every change and why) and the skill files in
[dex-skills/](dex-skills/) (step-by-step recipes). Nothing here needs a separate agent: these files are the context.

## What this is

A non-custodial swap aggregator and cross-chain bridge, **Monad-first**, with a game layer (the Dojo: Dojo Pass, warrior,
garden, free-MON faucet). Vanilla JS front end (Vite 5) with React mounted lazily for the Bushido tab and the faucet pond,
an Express 5 server that proxies keyed APIs, ethers v6, Reown AppKit for wallets. Live at
`https://bushido-dapp.onrender.com` (Render, auto-deploys from `main`, about 2 minutes).

## Commands

```bash
npm install && npm run build            # front end -> dist/
cd server && npm install && npm start   # API + the built site on :3001
npm run dev                             # Vite on :5173, proxies /api to :3001
npm test                                # node --test (all suites; fast, offline, fakes for the network)
npm run format                          # Prettier, ONLY on the files listed in package.json
npm run format:check                    # CI-style check of the same files
npm run verify:chains                   # read-only check of src/dex/chains.js against the real chains
```

- **New files are not formatted unless added to the `format` and `format:check` lists in `package.json`.** Add them.
- CI (GitHub Actions): Node 20, `npm ci`, `npm test`, `npm run build`. A green check must be for the final commit.
- Status page: `GET /api/health` (JSON: which keys are set, sources off, the faucet, and a `proxy` section). `/healthz`
  is not a real endpoint; it just returns the front page.

## How the owner works

1. Develop on a feature branch, never on `main`. Open a PR with the template (Summary, Why, Test plan).
2. **Every PR adds a CHANGELOG.md entry**: what changed and the reasoning, plus anything not verified.
3. **The owner merges.** Open the PR and wait for an explicit "merge"; then wait for CI on the final commit, merge, wait
   for the Render deploy, and check the live site (`/api/health`, a browser pass on a phone-sized screen).
4. Never commit mockups, scratch scripts or harnesses. Keep test scaffolding outside the repo.
5. If a fix attempt fails, report what happened instead of looping. The owner decides what to retry.
6. Say plainly what was not verified (for example: "no real wallet transaction was sent").

## Hard rules

- **Secrets:** provider keys live in the server environment only. Never in `VITE_*` (those ship to the browser), the repo,
  chat, screenshots or a committed file. `.env` files are not committed.
- **The faucet key is the one key the server holds.** It must be a fresh, dedicated wallet holding only a few MON
  (`FAUCET_PRIVATE_KEY`). Never use the owner's main wallet or any wallet that owns contracts or a Safe. A Safe cannot be
  the faucet wallet (no private key). Pattern: Safe as vault, small burner as the till, topped up by hand.
- **Simulate before signing.** Every swap and Dojo action is dry-run first; a revert means no signature request.
- **Reads never depend on the wallet's own connection.** Some wallet in-app browsers (Zerion's) refuse `eth_call` and
  balance reads. Use our public RPCs first, the wallet second (`src/simulate.js`, balances in `src/main.js`).
- **Ask the wallet which chain it is on** (`getWalletChainKey`, `eth_chainId`), not AppKit's cached value.
- **Red only when confirmed.** Glitches retry once quietly and show amber; red is for things that stayed broken or are
  really wrong (a mismatched deposit address, a real revert). The ops log records `high` only for a real revert.
- **Native coins** are listed with the chain's wrapped-native address and `isNative: true` (MON uses the WMON contract).
- Browser pickers: our own sheet (`src/token-picker.js`), because native dropdowns never open in some wallet browsers.

## Data rule: never add an address or decimals from memory

Hand-copied chain data has broken production twice (nine of fifteen Stargate token addresses were typo'd, truncated or
badly cased; BNB Chain's USDC/USDT were given 6 decimals when they have 18). Before adding or editing a chain or coin:

1. Read the token on its own chain (symbol, decimals, contract code). `npm run verify:chains` does this for the table.
2. Check it has real liquidity (KyberSwap price at about $20 and $200; `npm run verify:chains -- --prices`). The Monad
   list keeps only coins under 0.5% loss at $20 and 0.25% at $200.
3. Run each source through the app's own adapter code against a live server before listing it for a chain.
4. Watch for traps: BNB Chain stablecoins are **18 decimals**; addresses must pass the EIP-55 checksum; explorers
   (BscScan, Snowtrace, MonadVision) block automated requests, so link-check by hand; KyberSwap rate-limits (429) and
   sometimes returns "no route" once, so retry before concluding.

Recipes: [dex-skills/dex-chain-config](dex-skills/dex-chain-config/SKILL.md), [dex-swap-engine](dex-skills/dex-swap-engine/SKILL.md),
[dex-bridge](dex-skills/dex-bridge/SKILL.md), [dex-dojo-faucet](dex-skills/dex-dojo-faucet/SKILL.md),
[dex-audit](dex-skills/dex-audit/SKILL.md), [dex-test](dex-skills/dex-test/SKILL.md), [dex-deploy](dex-skills/dex-deploy/SKILL.md).

## Where things are

| Area | Files |
|---|---|
| Chains, coins, sources | `src/dex/chains.js` (single source of truth), `src/dex/adapters.js`, `src/dex/engine.js` |
| Wallet and networks | `src/config.js`, `src/utils/web3.js`, `src/siwx-share.js` |
| Swap UI | `src/main.js`, `src/token-picker.js`, `src/chain-menu.js`, `src/simulate.js` |
| Bushido tab and Dojo | `src/BushidoPanels.jsx`, `src/DojoCard.jsx`, `src/DojoPond.jsx`, `src/dojo/` |
| Faucet pond (Rewards tab) | `src/FaucetPond.jsx`, `src/faucet-button.js`, `src/faucet-pond-mount.jsx` |
| Bridge | `src/bridge*.js`, `server/near.js`, `server/stargate.js`, `server/aori.js`, `server/bridge-health.js` |
| Server | `server/index.js`, `server/limits.js`, `server/faucet.js`, `server/perks.js`, `server/switches.js` |
| Tests | `test/` (one file per area; fakes instead of the network) |

## Environment facts

- Render sits behind Cloudflare: **`TRUST_PROXY=3`** (Cloudflare, Render's edge, Render's proxy). Verify on
  `/api/health`: `proxy.yourIp` must be the visitor's own address, not an internal `10.x` one.
- Monad charges gas by gas limit (gas used equals gas limit), so do not read a "used = limit" transaction as out-of-gas.
- The Dojo contracts are verified on Sourcify (not on Monadscan): the Warrior's meters are `honor` and `reputation`
  on-chain, though the card labels them "Vitality" and "Focus".
- `.claude/skills/` holds vendored 1inch skills locked by `skills-lock.json`: do not hand-edit them.

## Known gaps (open, not forgotten)

- Ink has a single RPC. Aori's quote service has been returning 500s. 1inch Fusion+ is not configured.
- Zerion and Uniswap are not enabled on BNB Chain or Avalanche (unverified); Fusion cannot sell a native coin.
- A real swap transaction on BNB Chain or Avalanche has not been sent from this environment.
- Dojo meter labels (Vitality/Focus) differ from the contract's names (honor/reputation).
