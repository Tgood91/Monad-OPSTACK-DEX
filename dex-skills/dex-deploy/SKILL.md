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
| `VITE_0X_API_KEY` | Optional | Enables 0x source; origin-restricted rate-limit key |

`VITE_*` vars are baked at build time. If you change them, rebuild.

### Server (`server/.env`)

| Var | Required | Notes |
|---|---|---|
| `CDP_API_KEY_ID` | ✅ for Coinbase source | Coinbase Developer Platform |
| `CDP_API_KEY_SECRET` | ✅ for Coinbase source | |
| `ONEINCH_API_KEY` | ✅ for 1inch source | Without it, server falls back to Secure Vault socket (dev only) |
| `UNISWAP_API_KEY` | ✅ for Uniswap source | Same fallback behavior |
| `ZERION_API_KEY` | ✅ for Zerion source | |
| `NEAR_INTENTS_API_KEY` | Optional | 0.25% fee without key |
| `PORT` | Optional | Default 3001 |
| `TRUST_PROXY` | Set `1` behind nginx | Enables `req.ip` behind a proxy |

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
[ ] TRUST_PROXY=1 if behind nginx/proxy
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
- Forgetting `TRUST_PROXY=1` behind nginx — `req.ip` returns the proxy IP, breaking rate limiting.
- Not rebuilding after a `.env` change — `VITE_*` changes are invisible until rebuild.
