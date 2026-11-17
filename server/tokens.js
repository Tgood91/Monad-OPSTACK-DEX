/**
 * Bushido Token Registry
 * Loads the bundled token list once and serves filtered, searchable results.
 * Source: server/data/bushido-token-list.json
 *   – 2 216 tokens across Ethereum, Base, Optimism, Monad, Arbitrum, Polygon,
 *     BSC, Avalanche, zkSync.  Sourced from Uniswap + SushiSwap + Aerodrome.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load once at startup ──────────────────────────────────────────────────────
let RAW_LIST = null;
/** @type {Map<number, import('./tokens.js').Token[]>} */
const BY_CHAIN = new Map();

function ensureLoaded() {
  if (RAW_LIST) return;
  const src = path.join(__dirname, 'data', 'bushido-token-list.json');
  RAW_LIST = JSON.parse(readFileSync(src, 'utf8'));
  for (const tok of RAW_LIST.tokens) {
    if (!BY_CHAIN.has(tok.chainId)) BY_CHAIN.set(tok.chainId, []);
    BY_CHAIN.get(tok.chainId).push(tok);
  }
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Return tokens for a chain, optionally filtered by a search string.
 * @param {number}  chainId
 * @param {string}  [q]      - Searches symbol and name (case-insensitive prefix first, then includes)
 * @param {number}  [limit]  - Max results (default 50)
 * @returns {Token[]}
 */
export function searchTokens(chainId, q = '', limit = 50) {
  ensureLoaded();
  const pool = BY_CHAIN.get(Number(chainId)) ?? [];
  if (!q) return pool.slice(0, limit);

  const lq = q.toLowerCase().trim();
  const prefix = [];
  const contains = [];

  for (const tok of pool) {
    const sym = tok.symbol.toLowerCase();
    const name = tok.name.toLowerCase();
    if (sym === lq || sym.startsWith(lq)) {
      prefix.push(tok);
    } else if (sym.includes(lq) || name.includes(lq)) {
      contains.push(tok);
    }
    if (prefix.length + contains.length >= limit * 2) break; // early exit
  }

  return [...prefix, ...contains].slice(0, limit);
}

/**
 * Lookup a single token by address on a chain.
 * @param {number} chainId
 * @param {string} address   - checksummed or lowercase
 * @returns {Token|undefined}
 */
export function tokenByAddress(chainId, address) {
  ensureLoaded();
  const pool = BY_CHAIN.get(Number(chainId)) ?? [];
  const lAddr = address.toLowerCase();
  return pool.find(t => t.address.toLowerCase() === lAddr);
}

/**
 * All chain IDs present in the list.
 * @returns {number[]}
 */
export function supportedChainIds() {
  ensureLoaded();
  return [...BY_CHAIN.keys()];
}

/**
 * Returns a lightweight summary { chainId, count } for each chain.
 */
export function chainSummary() {
  ensureLoaded();
  return [...BY_CHAIN.entries()].map(([chainId, tokens]) => ({
    chainId,
    count: tokens.length,
  }));
}
