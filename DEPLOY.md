# Deploying with Node.js

One Node process serves the built frontend **and** the `/api/*` backend on the
same port. Works on any host that runs Node: a VPS, Render, Railway, Fly.io,
Replit (see [REPLIT_DEPLOY.md](REPLIT_DEPLOY.md)), etc.

## Requirements

- Node.js 18 or newer (tested on 22)
- Outbound HTTPS to the quote/bridge APIs and chain RPCs

## 1. Configure `.env`

Create a single `.env` in the **repo root**. `npm start` runs from the root, so
the server reads this file too. Only `VITE_*` values reach the browser; the
rest stay on the server.

```bash
# ---- Frontend (baked into the bundle at BUILD time) ----
VITE_PROJECT_ID=               # REQUIRED — https://cloud.reown.com
VITE_0X_API_KEY=               # optional — https://dashboard.0x.org
VITE_APP_URL=https://your-domain.com

# ---- Server (runtime, never sent to the browser) ----
PORT=3001
CORS_ORIGIN=https://your-domain.com
TRUST_PROXY=                   # 1 if behind nginx/Cloudflare/a PaaS router (see below)

UNISWAP_API_KEY=               # https://developers.uniswap.org
ONEINCH_API_KEY=               # https://portal.1inch.dev
ZERION_API_KEY=                # https://developers.zerion.io
CDP_API_KEY_ID=                # https://portal.cdp.coinbase.com
CDP_API_KEY_SECRET="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"

BUSHIDO_REGISTRY=              # optional — address from deploy-bushido.js
BASE_RPC=https://mainnet.base.org
WS_PRODUCTS=BTC-USD,ETH-USD
```

On a PaaS you can set these in the host's environment/secrets UI instead of a
file. Every key except `VITE_PROJECT_ID` is optional — a source without its key
just shows an error in the quote list. Keyless sources (Aerodrome, Velodrome,
KyberSwap, LI.FI, Velora) and the bridges (NEAR Intents, Stargate, Aori) work
with no keys.

## 2. Build and start

From the repo root:

```bash
npm ci && npm run build          # frontend -> dist/
cd server && npm ci && cd ..     # server has its own dependencies
npm start                        # node server/index.js
```

Check it:

```bash
curl http://localhost:3001/api/health
# {"ok":true,"coinbase":true|false,"stream":{...}}
```

**Changed a `VITE_*` value? Rebuild** (`npm run build`) and restart — those are
fixed at build time. Server-only keys just need a restart.

For a PaaS, use:

- **Build command:** `npm ci && npm run build && cd server && npm ci`
- **Start command:** `npm start`

## Vercel

`vercel.json` deploys the repo as two [Vercel Services](https://vercel.com/docs/services)
in one project:
- `app`: the Vite frontend, including the Bushido-dApp PWA files.
- `server`: the Express API in `server/`, which exports its `app` for Vercel.

`/api/*` is routed to `server` and everything else to `app`.

1. Import the GitHub repo in Vercel (or link it via the Vercel MCP / CLI). No
   build settings to change: `vercel.json` defines both services.
2. Project → Settings → Environment Variables:
   - `VITE_PROJECT_ID` (required for wallets), `VITE_APP_NAME=Bushido-dApp`,
     optional `VITE_0X_API_KEY`
   - `TRUST_PROXY=1` (Vercel's edge is a proxy)
   - optional server keys: `UNISWAP_API_KEY`, `ONEINCH_API_KEY`,
     `ZERION_API_KEY`, `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`
3. Redeploy after changing any `VITE_*` value (they're baked in at build).

Differences from an always-on Node host (Render, VPS):
- **No live WebSocket price feed.** On Vercel the server runs as a Function
  (`process.env.VERCEL` is set), so `/api/coinbase/prices` uses Coinbase REST.
  It already falls back to REST.
- **The rate limiter is per Function instance**, not global, because it is in memory.

## 3. Keep it running (VPS)

```bash
npm i -g pm2
pm2 start server/index.js --name dex
pm2 save && pm2 startup          # restart on reboot
pm2 logs dex                     # view logs
```

## 4. Reverse proxy and `TRUST_PROXY`

The API is rate-limited to 90 requests/minute per client IP. Behind a proxy,
the server sees the proxy's IP unless you set `TRUST_PROXY`:

| Setup | `TRUST_PROXY` |
|---|---|
| Clients connect directly to Node | leave unset |
| nginx / Caddy, or a PaaS router (Render, Railway, Fly, Replit) | `1` |
| Cloudflare → nginx → Node | `2` |

Don't set it when there's no proxy — clients could then fake their IP with an
`X-Forwarded-For` header and dodge the rate limit.

Minimal nginx site (the live price stream is server-side, so no WebSocket
proxying is needed):

```nginx
server {
  server_name your-domain.com;
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Add HTTPS with `certbot --nginx -d your-domain.com`. Wallets need HTTPS in
production.

## Notes

- The build warns that the main JS chunk is over 500 kB. It's harmless — the
  app works; it only affects first-load size.
- The NEAR Intents bridge charges a 0.25% fee when no API key is set.
- Uniswap and 1inch fall back to a vault socket if their env keys are unset;
  that socket only exists on the original dev machine, so set the env keys.
