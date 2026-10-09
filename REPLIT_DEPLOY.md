# Deploying the DEX on Replit

One process serves everything (frontend + API), so this is a single
Replit Deployment. Use a **Reserved VM** — the backend holds a persistent
WebSocket (price stream), which doesn't fit Autoscale's sleep/wake model.

## 1. Get the code into Replit

- Option A: push `dex-app/` to GitHub, then Replit → Create → Import from GitHub.
- Option B: upload `dex-app.zip`, extract it, and use the `dex-app/` folder
  as the Repl root.

## 2. Set Secrets first (important: before building)

Replit → Tools → Secrets. `VITE_*` values are baked into the frontend
**at build time**, so they must exist before the build runs.

| Secret | Required | Notes |
|---|---|---|
| `VITE_PROJECT_ID` | Yes | Reown AppKit project ID — https://cloud.reown.com |
| `CDP_API_KEY_ID` | No | Enables the Coinbase quote source (Base/Ethereum) |
| `CDP_API_KEY_SECRET` | No | Pairs with the key ID; server-side only |
| `VITE_1INCH_API_KEY` | No | 1inch quotes |
| `VITE_ZEROX_API_KEY` | No | 0x quotes |

Without the CDP keys the Coinbase source simply shows unkeyed — everything
else works. There is no `coinbase` CLI on Replit, so the env vars are the
only way to key CDP there.

## 3. Create the Deployment

Replit → Deploy → Reserved VM:

- **Build command:**
  `npm install && npm run build && cd server && npm install`
- **Run command:**
  `npm start`

That's it. `npm start` runs `node server/index.js`, which serves the built
frontend and the `/api/*` routes on one port. `PORT` is injected by Replit
automatically, and the frontend and API are same-origin so no CORS setup
is needed.

## 4. Developing in the workspace (optional)

Two shells:

```bash
npm run dev        # Vite on :5173, proxies /api → :3001
cd server && npm start   # API on :3001
```

## Notes

- The NEAR Intents bridge is keyless — no secret needed, works as-is.
- First load builds the frontend (~15s); the WS price stream connects
  in the background and the app works before it's up (REST fallback).
- Reserved VM keeps running 24/7; redeploy after changing Secrets that
  start with `VITE_` (they're baked at build time).
