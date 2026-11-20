// Small Monad faucet (chain 143, mainnet): sends a fixed drip of MON (default 0.5) to any wallet, once every
// 4 hours, whatever that wallet already holds.
//
// THIS IS THE ONE KEY THE SERVER HOLDS. It also pays the Base gas to collect Agent-tab payments
// (server/x402-local.js; the USDC goes from the payer straight to the fee wallet, never through this wallet),
// so it needs a little ETH on Base as well as MON. Keep the blast radius small:
//   * Use a DEDICATED wallet that holds only a few MON. The key can only spend that wallet's balance.
//   * Put FAUCET_PRIVATE_KEY in Render's Environment tab only. Never in the repo or in chat.
//   * With no key set the faucet is OFF and answers "not configured".
//   * Remove the key (or set FAUCET_DISABLED=1) to switch it off.
//
// Who can claim: any wallet, regardless of its balance or history, once per FAUCET_COOLDOWN_HOURS (default 4).
// The same wait applies per visitor IP, so one visitor cannot cycle through fresh wallets. There is also a
// daily cap on total drips. These limits are kept in memory, so a restart (every deploy) clears them; the
// faucet wallet's own balance is the hard limit either way.
//
// Settings (all optional except the key):
//   FAUCET_PRIVATE_KEY       0x + 64 hex. The faucet wallet. Required to turn it on.
//   FAUCET_DRIP_MON          default 0.5
//   FAUCET_COOLDOWN_HOURS    default 4     wait between claims, per wallet and per visitor IP
//   FAUCET_DAILY_CAP         default 100   claims per UTC day
//   FAUCET_RESERVE_MON       default 0.1   the faucet stops when its balance falls below drip + reserve

import { ethers } from "ethers";
import { logOps } from "./ops.js";

export const MONAD = { chainId: 143, rpcs: ["https://rpc.monad.xyz", "https://monad-mainnet.drpc.org"] };
const KEY = /^0x[0-9a-fA-F]{64}$/;

export function faucetConfig(env = process.env) {
  const key = (env.FAUCET_PRIVATE_KEY || "").trim();
  const mon = (v, d) => {
    try {
      return ethers.parseEther(String(v ?? d).trim() || String(d));
    } catch {
      return ethers.parseEther(String(d));
    }
  };
  const cap = Number(env.FAUCET_DAILY_CAP);
  const hours = Number(env.FAUCET_COOLDOWN_HOURS);
  return {
    enabled: KEY.test(key) && !/^(1|true)$/i.test(String(env.FAUCET_DISABLED || "")),
    key,
    drip: mon(env.FAUCET_DRIP_MON, "0.5"),
    cooldownMs: (Number.isFinite(hours) && hours > 0 ? hours : 4) * 3600_000,
    reserve: mon(env.FAUCET_RESERVE_MON, "0.1"),
    dailyCap: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 100,
  };
}

/** Private or proxy addresses can't tell visitors apart (e.g. TRUST_PROXY not set), so skip the per-IP limit. */
export function isPrivateIp(ip) {
  const a = String(ip || "").replace(/^::ffff:/, "");
  return !a || a === "::1" || /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/i.test(a);
}

const day = (t) => new Date(t).toISOString().slice(0, 10);

class FaucetError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createFaucet({
  env = process.env,
  now = () => Date.now(),
  makeProvider = (url) => new ethers.JsonRpcProvider(url, MONAD.chainId, { staticNetwork: true }),
  makeWallet = (key, provider) => new ethers.Wallet(key, provider),
  log = (e) => logOps(e).catch(() => {}),
} = {}) {
  const cfg = faucetConfig(env);
  const providers = new Map();
  const pv = (url) => providers.get(url) || providers.set(url, makeProvider(url)).get(url);
  const lastByWallet = new Map(); // address -> time of its last claim
  const lastByIp = new Map(); // visitor ip -> time of its last claim
  let counter = { day: day(now()), n: 0 };
  let queue = Promise.resolve(); // sends go one at a time, so the wallet's nonce never collides
  let address = null;
  if (cfg.enabled) address = new ethers.Wallet(cfg.key).address; // public address only; the key never leaves this module

  async function withRpc(fn) {
    let last;
    for (const url of MONAD.rpcs) {
      try {
        return await fn(pv(url));
      } catch (e) {
        last = e;
      }
    }
    throw new FaucetError(502, `Monad is not answering (${String(last?.message || last).slice(0, 60)})`);
  }

  const asAddress = (a) => {
    if (typeof a !== "string" || !ethers.isAddress(a)) throw new FaucetError(400, "bad address");
    return ethers.getAddress(a);
  };

  function wait(t, map, key) {
    const last = key ? map.get(key) : undefined;
    return last === undefined ? 0 : Math.max(0, last + cfg.cooldownMs - t);
  }
  function inWords(ms) {
    const m = Math.max(1, Math.ceil(ms / 60_000));
    const h = Math.floor(m / 60);
    return h ? `${h}h ${m % 60}m` : `${m}m`;
  }

  /** Any wallet may claim once per cooldown (and so may each visitor IP), whatever it holds. */
  function eligibility(addr, ip, t = now()) {
    const ms = Math.max(wait(t, lastByWallet, addr), wait(t, lastByIp, isPrivateIp(ip) ? null : ip));
    if (!ms) return { eligible: true };
    return { eligible: false, reason: `You can claim again in ${inWords(ms)}.`, nextClaimAt: t + ms };
  }

  async function faucetBalance() {
    return withRpc((p) => p.getBalance(address));
  }

  async function status(rawAddress, ip) {
    if (!cfg.enabled) return { enabled: false };
    const addr = asAddress(rawAddress);
    const elig = eligibility(addr, ip);
    const bal = await faucetBalance();
    return {
      enabled: true,
      faucet: address,
      dripMon: ethers.formatEther(cfg.drip),
      eligible: elig.eligible,
      reason: elig.reason,
      nextClaimAt: elig.nextClaimAt ? new Date(elig.nextClaimAt).toISOString() : undefined,
      cooldownHours: cfg.cooldownMs / 3600_000,
      available: bal >= cfg.drip + cfg.reserve && counter.n < cfg.dailyCap,
    };
  }

  function claim(rawAddress, ip) {
    const run = async () => {
      if (!cfg.enabled) throw new FaucetError(503, "The faucet is not set up.");
      const addr = asAddress(rawAddress);
      const t = now();
      if (day(t) !== counter.day) counter = { day: day(t), n: 0 };
      const ipKey = isPrivateIp(ip) ? null : ip;
      const elig = eligibility(addr, ip, t);
      if (!elig.eligible) throw new FaucetError(429, elig.reason);
      if (counter.n >= cfg.dailyCap)
        throw new FaucetError(429, "The faucet has reached its daily limit. Try again tomorrow.");
      const bal = await faucetBalance();
      if (bal < cfg.drip + cfg.reserve) {
        log({
          severity: "high",
          source: "faucet",
          message: "Faucet is out of MON: top up the faucet wallet " + address,
        });
        throw new FaucetError(503, "The faucet is empty right now. Please try again later.");
      }
      const sent = await withRpc(async (p) => {
        const w = makeWallet(cfg.key, p);
        const tx = await w.sendTransaction({ to: addr, value: cfg.drip });
        await tx.wait();
        return tx;
      });
      counter.n += 1;
      const done = now();
      lastByWallet.set(addr, done);
      if (ipKey) lastByIp.set(ipKey, done);
      for (const m of [lastByWallet, lastByIp])
        if (m.size > 5000) for (const [k, v] of m) if (done - v >= cfg.cooldownMs) m.delete(k);
      log({
        severity: "info",
        source: "faucet",
        message: `Sent ${ethers.formatEther(cfg.drip)} MON to ${addr.slice(0, 8)}… (${counter.n} today)`,
      });
      if (bal - cfg.drip < cfg.drip * 10n + cfg.reserve) {
        log({ severity: "warn", source: "faucet", message: "Faucet wallet is running low: top up " + address });
      }
      return { hash: sent.hash, amountMon: ethers.formatEther(cfg.drip) };
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  return { enabled: cfg.enabled, address, status, claim, FaucetError };
}

/** Express handlers around a faucet instance. */
export function faucetRoutes(faucet) {
  const fail = (res, e) => res.status(e.status || 502).json({ error: String(e.message || e).slice(0, 160) });
  return {
    status: async (req, res) => {
      try {
        res.json(await faucet.status(String(req.query.address || ""), req.ip));
      } catch (e) {
        fail(res, e);
      }
    },
    claim: async (req, res) => {
      try {
        res.json(await faucet.claim(String(req.body?.address || ""), req.ip));
      } catch (e) {
        fail(res, e);
      }
    },
  };
}
