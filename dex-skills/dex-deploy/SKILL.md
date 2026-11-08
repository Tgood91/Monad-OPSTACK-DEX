---
name: dex-deploy
description: Deploy or redeploy the DEX — build the frontend, configure server env, run with pm2/nginx, deploy to Replit, or deploy VirtueFeeRouter/VirtueAuditRegistry contracts with Hardhat/Foundry. Use before any production push or contract deploy.
---

# DEX Deployment

## Environment variables — must be set before build

### Frontend (`.env` in repo root — baked into the build at `npm run build`)

| Var | Required | Notes |
|---|---|---|
| `VITE_PROJECT_ID` | ✅ | Reown / WalletConnect project ID from cloud.reown.com |
| `VITE_APP_NAME`, `VITE_APP_DESCRIPTION`, `VITE_APP_URL`, `VITE_APP_ICON` | Optional | Shown in the wallet-connect popup |

`VITE_*` vars are baked at build time and visible to every visitor: **never put a secret in one** (0x's key is server-side now). If you change them, rebuild.

### Server (`server/.env`)

| Var | Required | Notes |
|---|---|---|
| `CDP_API_KEY_ID` | ✅ for Coinbase source | Coinbase Developer Platform |
| `CDP_API_KEY_SECRET` | ✅ for Coinbase source | |
| `ONEINCH_API_KEY` | ✅ for 1inch source | Without it, server falls back to Secure Vault socket (dev only) |
| `UNISWAP_API_KEY` | ✅ for Uniswap source | Same fallback behavior |
| `ZERION_API_KEY` | ✅ for Zerion source | |
| `ZEROX_API_KEY` | ✅ for 0x source | Server-side (0x v2 cannot be called from a browser); `VITE_0X_API_KEY` is still read as an old name |
| `DISABLED_SOURCES` | Optional | Comma-separated sources to switch off, e.g. `zerion,fusion` (see `server/switches.js`) |
| `FAUCET_PRIVATE_KEY` | Optional | Turns the Monad faucet on. A fresh dedicated wallet holding a few MON only. See [dex-dojo-faucet](../dex-dojo-faucet/SKILL.md) |
| `FAUCET_DRIP_MON`, `FAUCET_MIN_BALANCE_MON`, `FAUCET_DAILY_CAP`, `FAUCET_RESERVE_MON`, `FAUCET_DISABLED` | Optional | Faucet tuning (defaults 0.05, 0.02, 100, 0.1) |
| `PERKS_SECRET`, `PERK_QUOTE_MULTIPLIER` | Optional | Dojo Pass perk tokens survive restarts only with a secret; multiplier default 3 |
| `RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` | Optional | Emails high-severity errors |
| `PORT` | Optional | Default 3001 |
| `TRUST_PROXY` | **Set to the number of proxies in front** | `1` behind one nginx. **`3` on Render** (Cloudflare, Render's edge, Render's proxy). Wrong value = everyone shares one address (limits and the faucet's per-visitor rule break) or addresses can be faked. Verify on `/api/health` -> `proxy.yourIp` |

NEAR Intents needs no key here: it uses a vault surrogate when one is available and otherwise runs keyless (0.25% fee).

Copy `server/.env.example` — do not commit real keys.

## Build + run (Node host)

```bash
# 1. Install + build frontend
npm install
npm run build          # outputs to dist/

# 2. Install server deps
cd server && npm install

# 3. Set env
cp .env.example .env && nano .env   # fill in all keys

# 4. Run (serves dist/ + API on same port)
node index.js          # or: npm start
```

For production, use pm2:
```bash
pm2 start index.js --name dex
pm2 save
```

See `DEPLOY.md` for the full pm2 + nginx setup including SSL and `TRUST_PROXY`.

## Render (the reference deployment)

- Service `bushido-dapp`, branch `main`, auto-deploys on every push (about 2 minutes). Free plan: it can sleep when idle.
- Build `npm ci && npm run build && cd server && npm ci`; start `npm start`; health-check path `/healthz` (a page, not a real
  status endpoint: use `/api/health`).
- Env vars are set in the dashboard's Environment tab (never pasted into chat). Changing one needs a redeploy.
- After a deploy: `GET /api/health` (keys, faucet, `proxy`), then a phone-sized browser pass over the tabs.

## Replit deploy

See `REPLIT_DEPLOY.md`. Key points:
- Set all `server/.env` vars in Replit Secrets, not a file.
- `VITE_PROJECT_ID` goes in Replit Secrets under its exact name; Vite reads it at build time from the env.
- Run `npm run build` in the Replit shell before starting the server.

## Contract deployment

### VirtueFeeRouter

```bash
# Hardhat
npx hardhat run deploy-virtuefeerouter.js --network base

# Fraxtal
npx hardhat run deploy-virtuefeerouter-fraxtal.js --network fraxtal
```

Verify:
```bash
# Use verify-virtuefeerouter/standard-json-input.json + abi.json
npx hardhat verify --network base <deployed_address> <constructor_args>
```

After deploy, set the contract address in:
- `server/bushido.js` as `BUSHIDO_REGISTRY`
- Any frontend config that reads virtue scores on-chain

### VirtueAuditRegistry

Deploy with the same Hardhat flow. After deploy, update the registry address referenced in the fee router.

## Deployment checklist

```
[ ] VITE_PROJECT_ID set and frontend rebuilt
[ ] All server/.env keys filled (no placeholders)
[ ] npm run build ran after setting VITE_* vars
[ ] server/node_modules installed
[ ] TRUST_PROXY = the number of proxies in front (3 on Render); /api/health shows yourIp as the visitor's own address
[ ] Contract deployed and address updated in server/bushido.js
[ ] pm2 / process manager configured for auto-restart
[ ] Test one swap quote in production before announcing
[ ] CORS origin locked to production domain
```

## Rollback

pm2: `pm2 restart dex` after reverting to a previous build.
Contract: deploy a new version — contracts are not upgradeable unless using a proxy pattern. Check `VirtueFeeRouter.sol` for upgrade mechanisms before assuming immutability.

## Common deploy mistakes

- Building the frontend before setting `VITE_PROJECT_ID` — wallet modal will not initialize.
- Running `node server/index.js` from the repo root instead of `cd server && node index.js` — `__dirname` paths break.
- Wrong `TRUST_PROXY`: too low and every visitor looks like the proxy (shared limits, faucet per-visitor rule skipped); too high and addresses can be spoofed. Count the hops (`/api/health` -> `proxy.forwardedFor`) and set it to that.
- Not rebuilding after a `.env` change — `VITE_*` changes are invisible until rebuild.
