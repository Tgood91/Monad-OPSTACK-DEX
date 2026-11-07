// Small Monad faucet (chain 143, mainnet): sends a fixed drip of MON so a brand-new wallet can pay the
// gas to enter the Dojo or buy a Dojo Pass.
//
// THIS IS THE ONE PLACE THE SERVER HOLDS A KEY. Keep the blast radius small:
//   * Use a DEDICATED wallet that holds only a few MON. The key can only spend that wallet's balance.
//   * Put FAUCET_PRIVATE_KEY in Render's Environment tab only. Never in the repo or in chat.
//   * With no key set the faucet is OFF and answers "not configured".
//   * Remove the key (or set FAUCET_DISABLED=1) to switch it off.
//
// Who can claim: a wallet with NO activity on Monad: it has never sent a transaction (nonce 0) and holds
// less than FAUCET_MIN_BALANCE_MON. That alone makes it one claim per wallet: after the drip the balance
// is above the minimum, and spending it means sending a transaction, which ends eligibility for good.
// Extra limits: one claim per visitor IP per day, and a daily cap on total drips (resets on restart; the
// wallet's own balance is the hard limit either way).
//
// Settings (all optional except the key):
//   FAUCET_PRIVATE_KEY       0x + 64 hex. The faucet wallet. Required to turn it on.
//   FAUCET_DRIP_MON          default 0.05  (about 2 Dojo actions of gas at ~100 gwei)
//   FAUCET_MIN_BALANCE_MON   default 0.02  (a wallet holding less than this counts as "no MON")
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
  return {
    enabled: KEY.test(key) && !/^(1|true)$/i.test(String(env.FAUCET_DISABLED || "")),
    key,
    drip: mon(env.FAUCET_DRIP_MON, "0.05"),
    minBalance: mon(env.FAUCET_MIN_BALANCE_MON, "0.02"),
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
  const ipDay = new Map(); // ip -> yyyy-mm-dd of its last claim
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

  async function eligibility(addr) {
    const [balance, nonce] = await withRpc((p) => Promise.all([p.getBalance(addr), p.getTransactionCount(addr)]));
    if (nonce > 0) return { eligible: false, reason: "This wallet already has activity on Monad." };
    if (balance >= cfg.minBalance) return { eligible: false, reason: "This wallet already has MON for gas." };
    return { eligible: true };
  }

  async function faucetBalance() {
    return withRpc((p) => p.getBalance(address));
  }

  async function status(rawAddress) {
    if (!cfg.enabled) return { enabled: false };
    const addr = asAddress(rawAddress);
    const [elig, bal] = await Promise.all([eligibility(addr), faucetBalance()]);
    return {
      enabled: true,
      faucet: address,
      dripMon: ethers.formatEther(cfg.drip),
      eligible: elig.eligible,
      reason: elig.reason,
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
      if (ipKey && ipDay.get(ipKey) === counter.day)
        throw new FaucetError(429, "Only one claim per visitor per day. Try again tomorrow.");
      if (counter.n >= cfg.dailyCap)
        throw new FaucetError(429, "The faucet has reached its daily limit. Try again tomorrow.");
      const elig = await eligibility(addr);
      if (!elig.eligible) throw new FaucetError(409, elig.reason);
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
      if (ipKey) ipDay.set(ipKey, counter.day);
      if (ipDay.size > 5000) for (const [k, v] of ipDay) if (v !== counter.day) ipDay.delete(k);
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
        res.json(await faucet.status(String(req.query.address || "")));
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
