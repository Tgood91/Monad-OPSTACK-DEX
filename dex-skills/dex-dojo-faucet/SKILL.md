---
name: dex-dojo-faucet
description: Work on the Dojo (Dojo Pass, warrior, garden, ranks, daily bow), verified pass perks, and the Monad starter-MON faucet with its pond claim button. Use when changing the Dojo card, the three Monad contracts' integration, pass perks and request limits, the faucet rules or key handling, or the Rewards-tab pond.
---

# Dojo, pass perks and faucet

## The three Monad contracts (chain 143)

Source of all three is public and verified on **Sourcify** (not on Monadscan):
`https://sourcify-api-monad.blockvision.org/files/143/<address>`. Addresses are in `src/dojo/dojo-core.js` (`DOJO`).

| Contract (name in source) | What it does |
|---|---|
| **Dojo Pass** (`BushidoDojoGate`) | `purchasePass()` payable: at least `passFeeInWei` (0.001 MON default), the whole payment is forwarded to `treasury`, then the buyer is marked a holder. Owner can `grantPass`, `revokePass`, `setTreasury`, `setPassFee`. Reads: `hasDojoPass(address)`, `isPractitioner(address)` (the app uses this one, selector `0x89f5ffc7`), `passFeeInWei()` (`0x7fbab58a`). If the fee is ever 0, a pass is free. |
| **Warrior** (`BushidoProtocol`) | `enterDojo()` registers one warrior per wallet (no pass needed): `createdAt`, `lastActivity`, `level` 1, **`honor` 72**, **`reputation` 50**, `achievements` 0, `active`. Only `adjustHonor` (owner only) changes anything. |
| **Honor** (`BushidoVirtueRegistry`) | ERC-721 virtue registry: per-trader scores (`gi, yu, jin, rei, makoto`), trade records, honor tiers and badges, a `virtueController` that may submit trades. Not used by the app yet. |

All three are one-step `Ownable`: `transferOwnership(newOwner)` takes effect immediately, there is no accept step, and a wrong address
cannot be undone. Never call `renounceOwnership`. If ownership moves to a Safe, admin calls then go through the Safe.

**Naming gotcha:** the card labels the Warrior's two meters "Vitality" and "Focus" (`STAT_LABELS`, guesses made before the source was
found); the contract calls them `honor` and `reputation`. The field decoded as `streak` is the contract's `achievements`.
Renaming the labels is a user-visible change and was left for the owner to decide.

## The card and its pieces

| File | Role |
|---|---|
| `src/dojo/dojo-core.js` | Plain JSON-RPC reads and decoders (`loadDojo`, `loadFaucet`, `claimFaucet`, `loadMonBalance`), selectors, `dojoTx`. |
| `src/dojo/dojo-tx.js` | `runDojoTx`: switch to Monad, dry run, sign, wait. The dry run must pass before the wallet is asked to sign. |
| `src/dojo/growth.js` | Ranks (Deshi, Samurai, Ronin, Sensei, Meijin), growth score, the free daily bow and its streak (kept in the browser only). |
| `src/DojoCard.jsx`, `src/DojoPond.jsx` | The card and the garden (inline SVG; always shows its fullest look: five koi, lit lantern, red maple). |

Growth is **calculated** (level, days in the dojo, bow streak): the live contract only lets its owner change honor, so nothing
is written on-chain. A shared leaderboard or on-chain growth needs a server store or a new contract (not built).

## Pass perks (`server/perks.js`, `src/perks-client.js`)

1. The wallet signs one plain, time-stamped message (no transaction, no gas): `perksMessage(address, issuedAt)`; client and server
   build the identical text.
2. The server recovers the signer, rejects a claim older than 5 minutes, asks **Monad itself** whether that wallet holds a pass
   (`holdsPass`), and returns an HMAC token valid 7 days.
3. The browser sends it as `x-perk-token` on our own `/api/` calls (`installPerkHeader`); `server/limits.js` multiplies only the
   **quote** bucket (`PERK_QUOTE_MULTIPLIER`, default 3).

The token only raises a request limit and never touches funds. `PERKS_SECRET` keeps tokens valid across restarts (without it a
random secret is used and holders sign again after a restart). A revoked pass keeps perks until its token expires.

## The faucet (`server/faucet.js`)

Off unless `FAUCET_PRIVATE_KEY` is set. **This is the one key the server holds.**

- **Key handling:** a fresh, dedicated wallet holding a few MON; never the owner's main wallet or one that owns contracts or a
  Safe. A Safe cannot be the faucet wallet (it has no private key). Pattern: a Safe as the vault, a small burner as the till,
  topped up by hand. The key goes in the host's Environment tab only (never chat, repo or screenshots).
- **Who can claim:** a wallet that has never sent a transaction (nonce 0) and holds less than `FAUCET_MIN_BALANCE_MON` (0.02). That
  alone makes it one claim per wallet. Extra limits: one claim per visitor per day (skipped for private addresses, so it needs the
  right `TRUST_PROXY`: 3 on Render) and a daily cap (`FAUCET_DAILY_CAP`, 100). It stops when its balance falls below the drip plus
  `FAUCET_RESERVE_MON` (0.1) and logs low/empty warnings to the ops log.
- **No race:** eligibility is checked **inside** the one-at-a-time send queue, so two simultaneous claims cannot both pass.
- **Amount:** `FAUCET_DRIP_MON` (default 0.05; the live site sets 0.1). Keep it above `FAUCET_MIN_BALANCE_MON`.
- **Routes:** `GET /api/faucet/status?address=0x...` (the address is required: without it the answer is "bad address"; for a
  brand-new wallet it returns `eligible: true`); `POST /api/faucet/claim` with `{ address }`. `/api/health` -> `keys.faucet`
  says whether it is on.
- **Check it is healthy:** status for a fresh random address should say `enabled`, `eligible`, `available`; the faucet wallet's own
  balance is public on-chain (the status response includes its address).

## The pond claim button (Rewards tab)

`src/FaucetPond.jsx` makes the garden pond the button, mounted into `#faucetPondRoot` by `src/faucet-pond-mount.jsx` when the
Rewards tab first opens. The wording and rules live in `src/faucet-button.js` (`faucetBarView`, `runFaucetClaim`), which is pure and
unit-tested. Behaviour: not connected -> "Connect & claim 0.1 MON free" opens the wallet connect and finishes the claim when it
connects (a tap stays armed for 2 minutes, so an unrelated later connect never sends anything); connected and eligible -> "Claim";
sent -> green with a transaction link; a wallet that already has gas -> hidden unless tapped; faucet off -> not shown. The component
is deliberately **not** re-keyed per wallet, or the pending tap would be lost on connect.

## Tests

`test/dojo.test.js`, `test/growth.test.js`, `test/faucet.test.js`, `test/faucet-button.test.js`, `test/perks.test.js`,
`test/siwx-share.test.js` (one sign-in covers every EVM chain), `test/server-guards.test.js` (limits). Use injected `fetchImpl`,
fake providers and fake storage; never the real faucet or wallet.

## Common mistakes

- Using the owner's wallet, or any wallet that owns contracts, as the faucet key.
- Putting the faucet or perks secret anywhere but the server environment.
- Treating "Vitality/Focus" as the contract's names, or trying to grow the pet on-chain without owner-signed updates.
- Calling `transferOwnership` without re-checking the address; calling `renounceOwnership`.
- Forgetting `TRUST_PROXY` (the per-visitor faucet rule silently switches off).
- Checking the faucet only on the page: also read `/api/faucet/status?address=<fresh wallet>` and `/api/health`.
