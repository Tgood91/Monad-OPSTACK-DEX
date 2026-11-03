# DEX UI Wireframe — Layout, States & Navigation

The single map for how the DEX interface is laid out, what each view shows
in each state, and what survives a view switch. Read this before touching
`index.html`, `src/main.js`, or `src/bridge.js`.

## What this doc does NOT cover (no redundancies)

- What the DEX does, how swaps/bridges work, run/deploy steps → `README.md`
- Chain, token, and source config → `src/dex/chains.js`, `CHAINS.md`
- Quote engine, adapters, backend routes → `src/dex/engine.js`,
  `src/dex/adapters.js`, `server/*.js`
- VirtueFeeRouter contract + deploy → `DEPLOY_VIRTUEFEEROUTER.md`
  (repo root) and `contracts/VirtueFeeRouter.sol`

If a fact lives in one of those files, it is not repeated here — this doc
links to it instead.

## Global shell (all views)

One column, `max-width: 560px`, dark theme. Three persistent pieces:

| Piece | Element | Rule |
|---|---|---|
| Wallet bar | `#networkStatus` + `#connectBtn` | Always visible, never re-renders on view switch. Shows `Not connected` or `Chain ✓` + truncated address. Hitting Connect while disconnected shows the Toad Gang splash (1.2s), then the wallet modal. Already-connected click opens the Account view, no splash. |
| Banner | `.dex-banner` (`/img/banner.png`) | Full-width banner image at the very top of the container, above the title. Static — no interaction. |
| BUSHIDO header | `.bushido-header` (Toad Gang mark + gold BUSHIDO 八德 + `6 VIRTUES` badge) | Replaces the old `⚡ Multi-Chain DEX` h1. Theme: navy gradient bg, gold accent (`--accent: #d4a574`), cards `#101a2e`. No ERC-20z / launchpad component exists in the DEX — none was ported. |
| Virtue grid | `.virtue-grid` — 6 cards (Gi, Yu, Jin, Makoto, Meiyo, Chugi) | Kanji + romaji + gloss + live score + bar. Scores load from `GET /api/bushido/virtues?trader=` once the wallet connects; `—` until then. Rei is served by the API but not shown (matches the 6-card look). |
| Cron job section | `#cronCard` — Automated Daily Stablecoin Cron Job | Below the Bridge pane. Tabs: Cron Execution & Basket (schedule 0.05 USDC → USDbC/DAI/CADC/EURC, multi-router failover; run history lives on the ACP agent, not tracked here) · Druckenmiller Macro (live: regime + blended signals from `GET /api/macro`, falls back to the static note if the fetch fails) · Virtues & Risk Rules (Seykota gate Gi ≥ 0.60, Yu ≥ 0.50, EMA12/26; live gate status). |
| Macro feed (standalone) | `GET /api/macro` (`server/macro.js`) + `public/macro.html` → `/macro.html` | Druckenmiller × Seykota blend. 7 keyless Yahoo factors (10Y, 13W, DXY, HYG, HYG/LQD, BTC, ETH), each voted ±1 vs EMA26; regime = sum (≥ +3 RISK-ON, ≤ −3 RISK-OFF). Seykota trend per factor (gate bypassed for the trend; gate applied separately in the blended verdict for BTC/ETH/HYG). Optional `?trader=` → real virtue gate; without it, gate is `unknown`. 60s in-memory cache; one dead factor never kills the feed. FRED WALCL NOT fetched (times out from this server) — liquidity proxied by BTC + dollar + rates. Each blended signal carries its single dominant virtue (Gi = trend clarity, Yu = trend×regime agreement, Jin = volume vs 3mo avg; Rei/Makoto are execution-time, not scored) with the registry's tie-break (highest wins, ties → earliest). |
| View nav | `.tab-bar` — Swap / Bridge | Hub-and-spoke (see Nav rules). Bushido and Fee Router are NOT in the tab bar yet — see Planned views. |
| Container | `.container` | Single scroll column. No sidebars, no nested menus. |

## View 1 — Swap (`#swapPane`)

Existing elements, mapped to tiers:

**Tier 1 — Action core**
- From card: token select + amount input + `Balance: —` + `MAX` (`#fromToken`, `#fromAmount`, `#fromBalance`, `#maxBtn`)
- Flip (`#flipBtn`), To card: token select + read-only amount + balance (`#toToken`, `#toAmount`, `#toBalance`)
- Execute: `#approveBtn` (hidden until needed) → `#swapBtn`
- Outcome line: `#txStatus`

**Tier 2 — Telemetry**
- Chain grid (`#chainGrid`) — 5 chains: Celo, Optimism, Ink, Base, Unichain. Default: Celo.
- Source chips (`#srcRow`) — tap to toggle. Dashed + 🔑 when a keyed source has no key set.
- Quote table (`#quoteBox`) — rows per source, winner row highlighted, `BEST` badge, tap any row to select it. Failed sources show their reason inline.
- Quote detail (`#quoteDetail`) — source, rate, min received, est. gas.
- Slippage row — 0.3 / 0.5 / 1% presets + custom (0.05–10%). Default 0.5%.

**Tier 3 — Chrome:** wallet bar (global). Nothing else.

**Swap state matrix**

| State | What shows |
|---|---|
| Cold / no amount | `Enter an amount to compare quotes`. Swap button disabled: `Enter an amount`. |
| Same-token pair | Error: `Pick two different tokens`. Swap button: `Select tokens`. |
| No sources enabled | Error: `Enable at least one quote source`. |
| Quoting | Spinner + `Quoting via …`. Swap disabled. (8s timeout per source.) |
| Quoted, wallet disconnected | Quotes render; swap button: `Connect wallet to swap`. |
| Quoted, approval needed | `Approve <token> for <source>` appears above swap; swap disabled: `Approve first`. Native input skips approval. |
| Quoted, ready | Swap button: `Swap via <source>`. |
| Signing / confirming | `Building transaction…` → `Simulating…` → `Awaiting signature…` → `Confirming…` + explorer link. (Pre-sign `eth_call` simulation; a revert blocks the signature request.) |
| Success | `Swapped ✓` + tx link. Balances refresh, quotes refetch. |
| Failure | `Swap failed: …` (first 140 chars). Quote stays so the user can retry. |

## View 2 — Bridge (`#bridgePane`)

Existing elements, mapped to tiers:

**Tier 1 — Action core**
- From card: from-chain select + token select + amount + `MAX` (`#bFromChain`, `#bFromToken`, `#bFromAmount`, `#bMaxBtn`)
- Flip (`#bFlipBtn`), To card: to-chain select + token select + read-only amount (`#bToChain`, `#bToToken`, `#bToAmount`)
- Execute: `#bBridgeBtn`
- Deposit card (`#bDepositCard`, hidden until intent exists): deposit address (monospace, copy button), `Send deposit from wallet`, expiry note (~10 min)
- Status card (`#bStatusCard`, hidden until deposit sent): steps bar (`#bStepsBar`) + status box (`#bStatusBox`)

**Tier 2 — Telemetry**
- Bridge-via selector (`#bBridgeSource`): NEAR Intents / Stargate / Aori
- Bridge quote box (`#bQuoteBox`) + detail (`#bQuoteDetail`)
- Status steps: deposit → processing → done (done / active / failed styling)

**Tier 3 — Chrome:** wallet bar (global).

**Bridge state matrix**

| State | What shows |
|---|---|
| Cold / no amount | `Enter an amount to get a bridge quote`. Button disabled. |
| Wallet disconnected | `Connect your wallet to get a bridge quote`. |
| Same chain | Error: `Pick two different chains`. |
| Stargate token mismatch | Error: `Stargate bridges the same asset only — match the tokens`. |
| Quoting | Spinner + `Quoting via <source>…`. |
| Quoted | `1 <from> → <rate> <to>`. Button: `Intent created — send deposit above` after intent. |
| Intent created | Deposit card appears: address + copy + send-from-wallet. |
| Deposit sent | Status card appears; `Waiting for deposit confirmation…`. Polls every 10s. |
| Terminal — success | `Bridged ✓ <amount> <token> on <chain>`. |
| Terminal — refunded | `Refunded — funds returned to your wallet`. |
| Terminal — failed | `Bridge failed` (or `Incomplete deposit — partial amount sent`). |

## View 3 — Bushido dashboard (`src/BushidoTradingDashboard.jsx`)

Separate React component, NOT in the tab bar yet. Do not duplicate its
layout here — this is its tier map only:

- **Tier 1 — Action core:** active strategy signal card (`selectedStrategy`,
  default Seykota) + `lastSignal` line.
- **Tier 2 — Telemetry:** virtue scores list (5 on-chain + Meiyo/Chugi
  derived), strategies list (tap to select; selected = amber border).
- **Tier 3 — Chrome:** trader wallet prop + registry connection status.
- **States:** loading (virtues/strategies fetching) → live (scores +
  signal) → registry unset (neutral 0.5 fallback scores, signal still
  renders). Signal is blocked unless Gi ≥ 0.6 and Yu ≥ 0.5 — the card must
  say so when gated, not just go blank.

## View 4 — Fee Router (PLANNED — no UI exists yet)

VirtueFeeRouter is contract + deploy package only. When a view is built,
it follows this tier map:

- **Tier 1 — Action core:** fee params (base / max discount / honor
  threshold) + `recordVirtueAudit` form (trader, honor score, pass/fail).
  Both are Safe transactions — the view builds calldata, the Safe signs.
  It never sends from a connected EOA.
- **Tier 2 — Telemetry:** discount curve (what a given honor score pays),
  audit history per trader.
- **Tier 3 — Chrome:** Safe/governor status (is the connected wallet the
  governor?), contract address + Basescan link.
- **States:** disconnected → read-only (params + curve visible, actions
  disabled) → Safe-ready (actions build calldata) → submitted (Safe tx
  pending, link to Safe app).

## Nav rules (hub-and-spoke)

- One persistent tab bar. Views are spokes: Swap, Bridge, (Bushido,
  Fee Router when wired in).
- **Switching views never destroys state.** Panes are `display: none`,
  not unmounted: draft inputs, selected quotes, and a live bridge
  deposit/status card all survive a round trip. Never "fix" this by
  resetting a pane on switch.
- **What refetches on return:** swap quotes (stale after ~60s on some
  sources), bridge status (10s poll keeps running). **What never
  refetches from scratch:** user inputs, selected source, deposit address.
- Adding a spoke = one tab button + one pane + one `switchTab` case.
  Never nest menus inside a spoke.
- Deep config (custom slippage, integrator fee params, revenue routing)
  goes in bottom sheets / inline drawers on mobile, never a full-page
  navigation away from an in-flight action.

## Mobile-first wireframe rules

- Viewport order per view is exactly the tier order above: Tier 1 first,
  Tier 2 below, Tier 3 pinned in the shell. No reordering between
  desktop and mobile — one column everywhere.
- Execute CTA: full-width, thumb-reachable, last element before the
  status line. Never above the form.
- Quote sources / bridge sources: horizontal scrolling chips, not a grid
  — the list grows (10 swap sources today) and a grid wraps into noise.
- Quote table: one row per source, tap-to-select. Never a dropdown —
  comparison is the point.
- Deposit address: monospace, word-break, copy button beside it. The
  send-from-wallet button sits directly under the address, not in a
  separate card.
- Status steps: single horizontal steps bar (deposit → processing →
  done). Four states per step: pending, active, done, failed. No
  progress text outside the steps bar + one status line.
- Slippage / fee settings: inline row on Swap (already the pattern);
  bottom sheet only for the Fee Router's multi-field params.

## Proposed additions (NOT built — do not present as existing)

- **Solver auction ticker** (Tier 2, Bridge): live feed of intent fills /
  solver activity across NEAR Intents / Aori. Would sit between the
  quote box and the deposit card. No data source wired yet.
- **Bushido tab** in the main tab bar (currently a standalone component).
- **Fee Router view** (tier map above).
- **LI.FI as 4th Bridge source** — proposed, not approved, not wired.

## Build order

1. Wire Bushido into the tab bar (spoke + pane, no layout changes).
2. Add the Fee Router view per its tier map above.
3. Add the solver auction ticker to Bridge Tier 2 once a data source is
   chosen.
4. Only then revisit visual polish — layout and states first, styling last.
