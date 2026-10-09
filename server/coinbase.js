// Coinbase integration for the DEX backend.
// Holds the CDP API key SERVER-SIDE ONLY. Never import this file into frontend code.
//
// Two data paths:
//   1. Advanced Trade REST (api.coinbase.com) — spot prices/tickers, JWT (ES256) auth.
//   2. CDP Trade/Swap API (via @coinbase/cdp-sdk) — onchain swap quotes for the
//      user's own wallet to sign (createSwapQuote with `taker` = user's address).
//      Supported swap networks: base, ethereum.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CdpClient } from "@coinbase/cdp-sdk";

const CLI_CONFIG_PATH = path.join(os.homedir(), ".config", "coinbase", "config.json");

// ---------------------------------------------------------------------------
// Credentials: env vars first, fall back to the coinbase CLI's stored config.
// ---------------------------------------------------------------------------
function loadCdpCreds() {
  let keyId = process.env.CDP_API_KEY_ID;
  let keySecret = process.env.CDP_API_KEY_SECRET;

  if (!keyId || !keySecret) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CLI_CONFIG_PATH, "utf8"));
      const live = cfg?.environments?.live?.auth;
      if (live?.type === "cdp_key") {
        keyId ||= live.key_id;
        keySecret ||= live.key_secret;
      }
    } catch {
      // no CLI config; leave creds empty
    }
  }
  return { keyId, keySecret };
}

export function cdpConfigured() {
  const { keyId, keySecret } = loadCdpCreds();
  return Boolean(keyId && keySecret);
}

// ---------------------------------------------------------------------------
// CDP SDK client (lazy singleton)
// ---------------------------------------------------------------------------
let cdpClient = null;
export function getCdp() {
  if (!cdpClient) {
    const { keyId, keySecret } = loadCdpCreds();
    if (!keyId || !keySecret) throw new Error("CDP_API_KEY_ID / CDP_API_KEY_SECRET not configured");
    cdpClient = new CdpClient({ apiKeyId: keyId, apiKeySecret: keySecret });
  }
  return cdpClient;
}

// ---------------------------------------------------------------------------
// Spot prices via the PUBLIC Advanced Trade market-data endpoints.
// No key needed; the key is reserved for swap quotes (CDP Trade API).
// ---------------------------------------------------------------------------
export async function getSpotPrices(productIds) {
  const out = {};
  await Promise.all(
    productIds.slice(0, 20).map(async (pid) => {
      try {
        const res = await fetch(
          `https://api.coinbase.com/api/v3/brokerage/market/products/${encodeURIComponent(pid)}/ticker`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) throw new Error(`ticker ${res.status}`);
        const t = await res.json();
        const trade = t.trades?.[0];
        out[pid] = {
          price: trade?.price ?? null,
          bid: trade?.bid || null,
          ask: trade?.ask || null,
          time: trade?.time ?? null,
        };
      } catch (e) {
        out[pid] = { error: String(e.message).slice(0, 120) };
      }
    })
  );
  return out;
}

// ---------------------------------------------------------------------------
// CDP Swap quotes (user's wallet signs; we only build the quote)
// ---------------------------------------------------------------------------
const CHAIN_TO_CDP_NETWORK = { 8453: "base", 1: "ethereum" };

export function cdpNetworkForChain(chainId) {
  return CHAIN_TO_CDP_NETWORK[Number(chainId)] ?? null;
}

/**
 * Build a swap quote the user's wallet will sign.
 * Returns normalized: { toAmount, minToAmount, liquidityAvailable, tx: { to, data, value }, quoteId }
 */
export async function createSwapQuote({ chainId, fromToken, toToken, fromAmount, taker, slippageBps = 100 }) {
  const network = cdpNetworkForChain(chainId);
  if (!network) throw new Error(`CDP swaps unsupported on chain ${chainId} (supports base, ethereum)`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(taker)) throw new Error("invalid taker address");
  if (!/^0x[0-9a-fA-F]{40}$/.test(fromToken) || !/^0x[0-9a-fA-F]{40}$/.test(toToken)) {
    throw new Error("invalid token address");
  }
  const cdp = getCdp();
  const quote = await cdp.evm.createSwapQuote({
    network,
    fromToken,
    toToken,
    fromAmount: BigInt(fromAmount),
    taker,
    slippageBps,
  });
  if (!quote.liquidityAvailable) {
    return { liquidityAvailable: false };
  }
  // Normalize the transaction the user's wallet must sign.
  const tx = quote.transaction ?? quote.transactions?.[0] ?? null;
  return {
    liquidityAvailable: true,
    toAmount: quote.toAmount?.toString?.() ?? String(quote.toAmount ?? ""),
    minToAmount: quote.minToAmount?.toString?.() ?? String(quote.minToAmount ?? ""),
    quoteId: quote.quoteId ?? null,
    tx: tx
      ? { to: tx.to, data: tx.data, value: tx.value?.toString?.() ?? "0x0" }
      : null,
  };
}
