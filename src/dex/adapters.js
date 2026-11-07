// Quote adapters — each implements:
//   quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps) -> Quote|null
//   buildTx(quote, wallet, slippageBps) -> { to, data, value, spender }
// Quote = { source, amountOut: bigint, amountOutUsd?, gasUsd?, raw }
// All adapters are keyless except zerox (key via env).
// uniswap + zerion + oneinch go through the server proxy (keys server-side).

import { ethers } from 'ethers';
import { CHAINS, NATIVE_SENTINEL, QUOTE_TIMEOUT_MS } from './chains.js';

const ZERO = '0x0000000000000000000000000000000000000000';

// A server-proxied source answered with an error. Turn it into the reason shown
// in the quote list: a missing key reads "API key not set", not "no liquidity".
async function serverReason(r) {
  const j = await r.json().catch(() => ({}));
  const msg = String(j.error || `server ${r.status}`);
  if (/not set|no .*surrogate|not configured/i.test(msg)) return 'API key not set';
  return msg.slice(0, 80);
}

function env(key) {
  // Vite injects VITE_* vars at build time
  return (import.meta.env?.[key] || '').trim();
}

/* ================= Velodrome (on-chain, keyless) ================= */
const Velodrome = {
  TICK_SPACINGS: [1, 10, 50, 200],
  ABI_CL_FACTORY: ['function getPool(address,address,uint24) view returns (address)'],
  ABI_CL_QUOTER: ['function quoteExactInputSingle(address,address,int24,uint256,uint160) returns (uint256)'],
  ABI_V2_FACTORY: ['function getPool(address,address,bool) view returns (address)'],
  ABI_V2_ROUTER_QUOTE: ['function getAmountsOut(uint256,tuple(address from,address to,bool stable)[]) view returns (uint256[])'],
  ABI_V2_ROUTER_SWAP: ['function swapExactTokensForTokens(uint256,uint256,tuple(address from,address to,bool stable)[],address,uint256) returns (uint256[])'],
  ABI_V2_ROUTER_SWAP_ETH: ['function swapExactETHForTokens(uint256,tuple(address from,address to,bool stable)[],address,uint256) payable returns (uint256[])'],
  ABI_CL_ROUTER: ['function exactInputSingle(tuple(address tokenIn,address tokenOut,int24 tickSpacing,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)'],

  async _readProvider(chainKey) {
    const cfg = CHAINS[chainKey];
    for (const rpc of cfg.rpcs) {
      try {
        const p = new ethers.JsonRpcProvider(rpc, cfg.chainId, { staticNetwork: true });
        try {
          await Promise.race([p.getBlockNumber(), new Promise((_, r) => setTimeout(() => r(new Error('t/o')), 6000))]);
          return p;
        } catch (e) { p.destroy(); throw e; }
      } catch { /* next */ }
    }
    throw new Error('No RPC for ' + cfg.label);
  },

  async quote(chainKey, tokenIn, tokenOut, amountInWei) {
    const velo = CHAINS[chainKey].velo;
    if (!velo) return null;
    const rp = await this._readProvider(chainKey);
    const cands = [];
    if (velo.clFactory && velo.clQuoter) {
      const fac = new ethers.Contract(velo.clFactory, this.ABI_CL_FACTORY, rp);
      const quo = new ethers.Contract(velo.clQuoter, this.ABI_CL_QUOTER, rp);
      for (const ts of this.TICK_SPACINGS) {
        try {
          const pool = await fac.getPool(tokenIn.address, tokenOut.address, ts);
          if (pool === ethers.ZeroAddress) continue;
          const out = await quo.quoteExactInputSingle.staticCall(tokenIn.address, tokenOut.address, ts, amountInWei, 0);
          if (out > 0n) cands.push({ kind: 'CL', tickSpacing: ts, pool, amountOut: out, router: velo.clRouter });
        } catch { /* skip */ }
      }
    }
    if (velo.v2Factory && velo.v2Router) {
      const fac = new ethers.Contract(velo.v2Factory, this.ABI_V2_FACTORY, rp);
      const rou = new ethers.Contract(velo.v2Router, this.ABI_V2_ROUTER_QUOTE, rp);
      for (const stable of [true, false]) {
        try {
          const pool = await fac.getPool(tokenIn.address, tokenOut.address, stable);
          if (pool === ethers.ZeroAddress) continue;
          const routes = [{ from: tokenIn.address, to: tokenOut.address, stable }];
          const amts = await rou.getAmountsOut.staticCall(amountInWei, routes);
          const out = amts[amts.length - 1];
          if (out > 0n) cands.push({ kind: stable ? 'v2-stable' : 'v2-volatile', pool, amountOut: out, routes, router: velo.v2Router });
        } catch { /* skip */ }
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => (a.amountOut < b.amountOut ? 1 : -1));
    const best = cands[0];
    return { source: 'velodrome', amountOut: best.amountOut, raw: best };
  },

  async buildTx(q, wallet, slippageBps, signer) {
    const b = q.raw;
    const deadline = Math.floor(Date.now() / 1000) + 900;
    const minOut = b.amountOut * BigInt(10000 - slippageBps) / 10000n;
    if (b.kind === 'CL') {
      const router = new ethers.Contract(b.router, this.ABI_CL_ROUTER, signer);
      const params = { tokenIn: q.tokenIn.address, tokenOut: q.tokenOut.address, tickSpacing: b.tickSpacing, recipient: wallet, deadline, amountIn: q.amountInWei, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 };
      const pop = await router.exactInputSingle.populateTransaction(params, { value: q.tokenIn.isNative ? q.amountInWei : 0 });
      return { to: b.router, data: pop.data, value: q.tokenIn.isNative ? q.amountInWei : 0n, spender: b.router };
    }
    const router = new ethers.Contract(b.router, q.tokenIn.isNative ? this.ABI_V2_ROUTER_SWAP_ETH : this.ABI_V2_ROUTER_SWAP, signer);
    const pop = q.tokenIn.isNative
      ? await router.swapExactETHForTokens.populateTransaction(minOut, b.routes, wallet, deadline, { value: q.amountInWei })
      : await router.swapExactTokensForTokens.populateTransaction(q.amountInWei, minOut, b.routes, wallet, deadline);
    return { to: b.router, data: pop.data, value: q.tokenIn.isNative ? q.amountInWei : 0n, spender: b.router };
  },
};

/* ================= Aerodrome (on-chain, keyless) — Base ================= */
// Aerodrome is Velodrome's ve(3,3) fork and the dominant DEX on Base.
// Its Router2 uses a 4-field Route struct (from, to, stable, factory).
// Same trust model as the Velodrome adapter: pure view-call quotes,
// execution signed by the user's wallet.
const Aerodrome = {
  ABI_V2_ROUTER_QUOTE: ['function getAmountsOut(uint256,tuple(address from,address to,bool stable,address factory)[]) view returns (uint256[])'],
  ABI_V2_ROUTER_SWAP: ['function swapExactTokensForTokens(uint256,uint256,tuple(address from,address to,bool stable,address factory)[],address,uint256) returns (uint256[])'],
  ABI_V2_ROUTER_SWAP_ETH: ['function swapExactETHForTokens(uint256,tuple(address from,address to,bool stable,address factory)[],address,uint256) payable returns (uint256[])'],

  async quote(chainKey, tokenIn, tokenOut, amountInWei) {
    const aero = CHAINS[chainKey].aero;
    if (!aero) return null;
    const rp = await Velodrome._readProvider(chainKey);
    const rou = new ethers.Contract(aero.v2Router, this.ABI_V2_ROUTER_QUOTE, rp);
    const cands = [];
    for (const stable of [false, true]) {
      try {
        const routes = [{ from: tokenIn.address, to: tokenOut.address, stable, factory: aero.v2Factory }];
        const amts = await rou.getAmountsOut.staticCall(amountInWei, routes);
        const out = amts[amts.length - 1];
        if (out > 0n) cands.push({ kind: stable ? 'v2-stable' : 'v2-volatile', amountOut: out, routes });
      } catch { /* no pool for this stable flag */ }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => (a.amountOut < b.amountOut ? 1 : -1));
    const best = cands[0];
    return { source: 'aerodrome', amountOut: best.amountOut, raw: best };
  },

  async buildTx(q, wallet, slippageBps, signer) {
    const aero = CHAINS[q.chainKey].aero;
    const b = q.raw;
    const deadline = Math.floor(Date.now() / 1000) + 900;
    const minOut = b.amountOut * BigInt(10000 - slippageBps) / 10000n;
    const router = new ethers.Contract(aero.v2Router, q.tokenIn.isNative ? this.ABI_V2_ROUTER_SWAP_ETH : this.ABI_V2_ROUTER_SWAP, signer);
    const pop = q.tokenIn.isNative
      ? await router.swapExactETHForTokens.populateTransaction(minOut, b.routes, wallet, deadline, { value: q.amountInWei })
      : await router.swapExactTokensForTokens.populateTransaction(q.amountInWei, minOut, b.routes, wallet, deadline);
    return { to: aero.v2Router, data: pop.data, value: q.tokenIn.isNative ? q.amountInWei : 0n, spender: aero.v2Router };
  },
};

/* ================= KyberSwap (keyless) ================= */
// KyberSwap credits traffic to the app named in the x-client-id header (it appears in the swap
// data's source tag). KyberSwap's browser (CORS) rules allow this header on both calls.
export const KYBER_CLIENT_ID = 'bushido-dapp';
const KYBER_HEADERS = { 'x-client-id': KYBER_CLIENT_ID };

const KyberSwap = {
  async quote(chainKey, tokenIn, tokenOut, amountInWei) {
    const name = CHAINS[chainKey].kyberName;
    if (!name) return null;
    const inAddr = tokenIn.isNative ? NATIVE_SENTINEL : tokenIn.address;
    const url = `https://aggregator-api.kyberswap.com/${name}/api/v1/routes?tokenIn=${inAddr}&tokenOut=${tokenOut.address}&amountIn=${amountInWei.toString()}&gasInclude=true`;
    const r = await (await fetch(url, { headers: KYBER_HEADERS })).json();
    const rs = r?.data?.routeSummary;
    if (!rs?.amountOut) return null;
    return { source: 'kyberswap', amountOut: BigInt(rs.amountOut), amountOutUsd: parseFloat(rs.amountOutUsd || 0), gasUsd: parseFloat(rs.gasUsd || 0), raw: rs };
  },
  async buildTx(q, wallet, slippageBps) {
    const name = CHAINS[q.chainKey].kyberName;
    const r = await (await fetch(`https://aggregator-api.kyberswap.com/${name}/api/v1/route/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...KYBER_HEADERS },
      body: JSON.stringify({ routeSummary: q.raw, sender: wallet, recipient: wallet, slippageTolerance: slippageBps, deadline: Math.floor(Date.now() / 1000) + 1200 }),
    })).json();
    const tx = r?.data;
    if (!tx?.data || !tx?.routerAddress) throw new Error('KyberSwap build failed');
    // The build response names the target `routerAddress` and the native amount
    // `transactionValue` (there is no `to` / `value`). The router is also the
    // ERC-20 approval spender.
    return { to: tx.routerAddress, data: tx.data, value: BigInt(tx.transactionValue || 0), spender: tx.routerAddress };
  },
};

/* ================= LI.FI (keyless) ================= */
const Lifi = {
  async quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps) {
    const id = CHAINS[chainKey].chainId;
    const fromToken = tokenIn.isNative ? ZERO : tokenIn.address;
    const slip = ((slippageBps ?? 50) / 10000).toFixed(4);
    const url = `https://li.quest/v1/quote?fromChain=${id}&toChain=${id}&fromToken=${fromToken}&toToken=${tokenOut.address}&fromAmount=${amountInWei.toString()}&fromAddress=${wallet || '0x0000000000000000000000000000000000000001'}&slippage=${slip}`;
    const r = await (await fetch(url)).json();
    if (!r?.estimate?.toAmount || !r?.transactionRequest) return null;
    return { source: 'lifi', amountOut: BigInt(r.estimate.toAmount), amountOutUsd: parseFloat(r.estimate.toAmountUSD || 0), gasUsd: parseFloat(r.estimate.gasCosts?.[0]?.amountUSD || 0), raw: r };
  },
  async buildTx(q) {
    const t = q.raw.transactionRequest;
    if (!t?.data) throw new Error('LI.FI build failed');
    return { to: t.to, data: t.data, value: BigInt(t.value || 0), spender: t.to };
  },
};

/* ================= Velora / ParaSwap (keyless) ================= */
const Velora = {
  async quote(chainKey, tokenIn, tokenOut, amountInWei) {
    const id = CHAINS[chainKey].chainId;
    const src = tokenIn.isNative ? NATIVE_SENTINEL : tokenIn.address;
    let url = `https://api.paraswap.io/prices?network=${id}&srcToken=${src}&destToken=${tokenOut.address}&amount=${amountInWei.toString()}&side=SELL&version=6.2`;
    if (chainKey === 'unichain') url += `&srcDecimals=${tokenIn.decimals}&destDecimals=${tokenOut.decimals}`;
    const r = await (await fetch(url)).json();
    const pr = r?.priceRoute;
    if (!pr?.destAmount) return null;
    return { source: 'velora', amountOut: BigInt(pr.destAmount), amountOutUsd: parseFloat(pr.destUSD || 0), gasUsd: parseFloat(pr.gasCostUSD || 0), raw: pr };
  },
  async buildTx(q, wallet, slippageBps) {
    const id = CHAINS[q.chainKey].chainId;
    const r = await (await fetch(`https://api.paraswap.io/transactions/${id}?ignoreChecks=true`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcToken: q.tokenIn.isNative ? NATIVE_SENTINEL : q.tokenIn.address,
        destToken: q.tokenOut.address, srcDecimals: q.tokenIn.decimals, destDecimals: q.tokenOut.decimals,
        srcAmount: q.raw.srcAmount, // required by /transactions ("Missing srcAmount" otherwise)
        priceRoute: q.raw, userAddress: wallet, receiver: wallet, slippage: slippageBps,
      }),
    })).json();
    if (!r?.data) throw new Error('Velora build failed' + (r?.error ? ': ' + String(r.error).slice(0, 60) : ''));
    return { to: r.to, data: r.data, value: BigInt(r.value || 0), spender: r.to };
  },
};

/* ================= 1inch Fusion (gasless; user signs an order, resolvers fill it) ================= */
// Not a transaction: buildTx is never used. src/main.js signs and submits the order
// via src/dex/fusion-wallet.js. The SDK loads on demand and talks to our /api/fusion
// relay, which holds the 1inch key. Sells ERC-20 tokens only (no native coin).
const Fusion = {
  gasless: true,
  // Skip before loading the SDK: Fusion only sells ERC-20 tokens, not the native coin.
  canQuote(chainKey, tokenIn) {
    return tokenIn.isNative ? 'sells tokens only' : null;
  },
  async quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps) {
    const chainId = CHAINS[chainKey].chainId;
    const core = await import('./fusion-core.js');
    try {
      const r = await core.fusionQuote({
        chainId, origin: globalThis.location?.origin ?? '', tokenIn, tokenOut, amountInWei,
        wallet: wallet && wallet !== ZERO ? wallet : undefined, slippageBps: slippageBps ?? 50,
      });
      return { source: 'fusion', amountOut: r.amountOut, minAmountOut: r.minAmountOut, gasless: true, raw: r };
    } catch (e) {
      throw new Error(core.explainFusionError(e));
    }
  },
  async buildTx() { throw new Error('Fusion orders are signed, not sent as a transaction'); },
};

/* ================= 1inch (swap API via server proxy) ================= */
// Key lives in the Secure Vault, used SERVER-SIDE (server/oneinch.js).
// 1inch uses Bearer auth, which the vault surrogate pattern handles cleanly.
// Router fallback addresses live in CHAINS[chainKey].routers for Base.
const OneInch = {
  async quote(chainKey, tokenIn, tokenOut, amountInWei, wallet) {
    const id = CHAINS[chainKey].chainId;
    const src = tokenIn.isNative ? NATIVE_SENTINEL : tokenIn.address;
    let r;
    try {
      r = await fetch('/api/oneinch/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId: id, src, dst: tokenOut.address, amountAtomic: amountInWei.toString() }),
      });
    } catch { return null; }
    if (!r.ok) throw new Error(await serverReason(r));
    const j = await r.json().catch(() => null);
    if (!j?.amountOut) return null;
    return { source: 'oneinch', amountOut: BigInt(j.amountOut), raw: { ...j, chainKey, tokenIn, tokenOut, amountInWei: amountInWei.toString() } };
  },
  async buildTx(q, wallet, slippageBps) {
    const { chainKey, tokenIn, tokenOut, amountInWei } = q.raw;
    const id = CHAINS[chainKey].chainId;
    const src = tokenIn.isNative ? NATIVE_SENTINEL : tokenIn.address;
    let r;
    try {
      r = await fetch('/api/oneinch/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId: id, src, dst: tokenOut.address, amountAtomic: amountInWei, from: wallet, slippageBps: slippageBps ?? 50 }),
      });
    } catch { throw new Error('1inch swap build failed'); }
    if (!r.ok) throw new Error('1inch swap build failed');
    const j = await r.json().catch(() => null);
    if (!j?.data) throw new Error('1inch build failed');
    return { to: j.to, data: j.data, value: BigInt(j.value || 0), spender: j.to };
  },
};

/* ================= 0x (keyed, via the server) ================= */
// 0x v2 needs a header that 0x's CORS rules block in browsers, so the call (and the
// key) live on the server: /api/zerox/quote (server/zerox.js).
const ZeroX = {
  async quote(chainKey, tokenIn, tokenOut, amountInWei, wallet) {
    const id = CHAINS[chainKey].chainId;
    const sell = tokenIn.isNative ? NATIVE_SENTINEL : tokenIn.address;
    const qs = new URLSearchParams({ chainId: String(id), sellToken: sell, buyToken: tokenOut.address, sellAmount: amountInWei.toString() });
    if (wallet) qs.set('taker', wallet);
    let r;
    try { r = await fetch(`/api/zerox/quote?${qs}`); } catch { return null; }
    if (!r.ok) throw new Error(await serverReason(r));
    const j = await r.json().catch(() => null);
    if (!j?.buyAmount) return null;
    return {
      source: 'zerox', amountOut: BigInt(j.buyAmount),
      amountOutUsd: j.buyAmount && j.price ? parseFloat(j.buyAmount) * parseFloat(j.price) / 10 ** tokenIn.decimals : undefined,
      raw: j,
    };
  },
  async buildTx(q) {
    const j = q.raw;
    if (!j.transaction?.data) throw new Error('0x build failed');
    const spender = j.issues?.allowance?.spender || j.transaction.to;
    return { to: j.transaction.to, data: j.transaction.data, value: BigInt(j.transaction.value || 0), spender };
  },
};

/* ================= Zerion (swap API via server proxy) ================= */
// Key lives SERVER-SIDE (server/zerion.js, ZERION_API_KEY env) — never in the
// browser bundle. Zerion's swap API needs HTTP Basic auth, which the vault
// surrogate pattern can't produce, so the backend holds the key.
// EVM chains only — Zerion's swap API does not support Monad (verified 2026-10-07).
const Zerion = {
  supported: { 1: true, 10: true, 56: true, 130: true, 8453: true, 42161: true, 43114: true, 57073: true },
  canQuote(chainKey, tokenIn, tokenOut, wallet) {
    if (!this.supported[CHAINS[chainKey].chainId]) return 'chain not supported';
    if (!wallet || wallet === ZERO) return 'needs a connected wallet';
    return null;
  },
  async quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps) {
    const id = CHAINS[chainKey].chainId;
    if (!this.supported[id]) return null;
    const fin = tokenIn.isNative ? ZERO : tokenIn.address;
    const fout = tokenOut.isNative ? ZERO : tokenOut.address;
    const amountHuman = ethers.formatUnits(amountInWei, tokenIn.decimals);
    let r;
    try {
      r = await fetch('/api/zerion/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainId: id,
          tokenIn: fin,
          tokenOut: fout,
          amountHuman,
          taker: wallet && wallet !== ZERO ? wallet : undefined,
          slippageBps: slippageBps ?? 50,
        }),
      });
    } catch { return null; }
    if (!r.ok) throw new Error(await serverReason(r));
    const q = await r.json().catch(() => null);
    if (!q?.amountOut) return null;
    const outWei = q.amountOut.includes('.')
      ? ethers.parseUnits(Number(q.amountOut).toFixed(tokenOut.decimals), tokenOut.decimals)
      : BigInt(q.amountOut);
    return {
      source: 'zerion',
      amountOut: outWei,
      amountOutUsd: q.amountOutUsd ?? undefined,
      raw: q,
    };
  },
  async buildTx(q) {
    if (!q.raw?.to || !q.raw?.data) throw new Error('Zerion build failed: no tx');
    return {
      to: q.raw.to,
      data: q.raw.data,
      value: BigInt(q.raw.value || 0),
      spender: q.raw.spender || q.raw.to,
    };
  },
};

/* ================= Coinbase (CDP Swap API via server proxy) ================= */
// Key lives SERVER-SIDE (server/coinbase.js) — never in the browser bundle.
// CDP swaps support base + ethereum. Native token entries in chains.js use the
// wrapped address, so quotes are for WETH; the normal ERC20 approval flow applies.
const Coinbase = {
  supported: { 8453: true, 1: true },
  canQuote(chainKey, tokenIn, tokenOut, wallet) {
    if (!this.supported[CHAINS[chainKey].chainId]) return 'chain not supported';
    if (!wallet || wallet === ZERO) return 'needs a connected wallet';
    return null;
  },
  async quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps) {
    const id = CHAINS[chainKey].chainId;
    if (!this.supported[id]) return null;
    if (!wallet || wallet === ZERO) return null; // CDP needs a real taker address
    let r;
    try {
      r = await fetch('/api/coinbase/swap-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainId: id,
          fromToken: tokenIn.address,
          toToken: tokenOut.address,
          fromAmount: amountInWei.toString(),
          takerAddress: wallet,
          slippageBps: slippageBps ?? 100,
        }),
      });
    } catch { return null; }
    if (!r.ok) throw new Error(await serverReason(r));
    const q = (await r.json())?.quote;
    if (!q?.liquidityAvailable || !q?.toAmount) return null;
    return { source: 'coinbase', amountOut: BigInt(q.toAmount), raw: q };
  },
  async buildTx(q) {
    const t = q.raw?.tx;
    if (!t?.to || !t?.data) throw new Error('Coinbase build failed');
    return { to: t.to, data: t.data, value: BigInt(t.value || 0), spender: t.to };
  },
};

/* ================= Uniswap (Trading API via server proxy) ================= */
// Key lives in the Secure Vault, used SERVER-SIDE (server/uniswap.js).
// Uniswap's API rejects direct browser calls (CORS) — must go through the backend.
// Native token entries in chains.js use the wrapped address, so quotes are for
// e.g. WETH; the normal ERC20 approval flow applies (spender = Universal Router).
const Uniswap = {
  supported: { 10: true, 57073: true, 8453: true, 130: true },
  canQuote(chainKey, tokenIn, tokenOut, wallet) {
    if (!this.supported[CHAINS[chainKey].chainId]) return 'chain not supported';
    if (!wallet || wallet === ZERO) return 'needs a connected wallet';
    return null;
  },
  async quote(chainKey, tokenIn, tokenOut, amountInWei, wallet, slippageBps) {
    const id = CHAINS[chainKey].chainId;
    if (!this.supported[id]) return null;
    if (!wallet || wallet === ZERO) return null; // Uniswap needs a real swapper address
    let r;
    try {
      r = await fetch('/api/uniswap/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainId: id,
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          amountAtomic: amountInWei.toString(),
          takerAddress: wallet,
          slippageBps: slippageBps ?? 50,
        }),
      });
    } catch { return null; }
    if (!r.ok) throw new Error(await serverReason(r));
    const q = (await r.json())?.quote;
    if (!q?.amountOut) return null;
    return {
      source: 'uniswap',
      amountOut: BigInt(q.amountOut),
      gasUsd: q.gasUsd ?? null,
      raw: q,
    };
  },
  async buildTx(q) {
    const rawQuote = q.raw?.rawQuote;
    if (!rawQuote) throw new Error('Uniswap build failed: no quote');
    let r;
    try {
      r = await fetch('/api/uniswap/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote: rawQuote }),
      });
    } catch { throw new Error('Uniswap swap build failed'); }
    if (!r.ok) throw new Error('Uniswap swap build failed');
    const t = (await r.json())?.tx;
    if (!t?.to || !t?.data) throw new Error('Uniswap build failed');
    return { to: t.to, data: t.data, value: BigInt(t.value || 0), spender: t.to };
  },
};

export const ADAPTERS = {
  aerodrome: Aerodrome,
  velodrome: Velodrome,
  uniswap: Uniswap,
  kyberswap: KyberSwap,
  lifi: Lifi,
  velora: Velora,
  coinbase: Coinbase,
  oneinch: OneInch,
  fusion: Fusion,
  zerox: ZeroX,
  zerion: Zerion,
};

// Which adapters need keys — used to show "key missing" state instead of failing silently.
// uniswap + zerion + oneinch are server-proxied (keys server-side), so they never show key-missing.
// A source needs a browser-side key only if its adapter defines key(). Today none do:
// keyed sources hold their key on the server and are checked via /api/health.
export function adapterNeedsKey(src) {
  return typeof ADAPTERS[src]?.key === 'function';
}

export function adapterKeySet(src) {
  if (!adapterNeedsKey(src)) return true;
  return !!ADAPTERS[src].key();
}
