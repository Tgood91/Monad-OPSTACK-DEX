// Dojo Pass perks, verified. The server must be able to trust "this visitor holds a pass", so:
//   1. The wallet signs ONE plain message (no transaction, no gas) saying it wants pass perks.
//   2. The server recovers the signer, checks the pass on Monad itself, and issues a signed token (HMAC).
//   3. The token lasts 7 days and is sent back as the `x-perk-token` header; it can't be forged or moved to
//      another wallet's claim. Perk today: a larger quote allowance (PERK_QUOTE_MULTIPLIER, default 3).
// The token is NOT the key to funds: it only raises a request limit. Losing it costs nothing.
//
// PERKS_SECRET (Render env, any long random string) keeps tokens valid across restarts. Without it a random
// secret is made at start-up: perks still work, but everyone re-signs after a restart.

import crypto from "node:crypto";
import { ethers } from "ethers";
import { MONAD } from "./faucet.js";

export const PASS = "0x2647faf3aaa708d0b9a110744790e1f637fcca53";
export const PASS_HOLDER_SEL = "0x89f5ffc7";
export const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;
export const CLAIM_MAX_AGE_MS = 5 * 60 * 1000;
export const QUOTE_MULTIPLIER_DEFAULT = 3;

/** The exact text the wallet signs. The client builds it with this same function. */
export const perksMessage = (address, issuedAt) =>
  `Bushido Dojo Pass perks\nI hold a Dojo Pass and want its perks on this site.\nWallet: ${address}\nIssued: ${issuedAt}\nThis signs a message only. It sends no transaction and costs no gas.`;

const b64 = (b) => Buffer.from(b).toString("base64url");
const sign = (payload, secret) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

export function makeToken(address, now, secret, ttl = TOKEN_TTL_MS) {
  const payload = b64(JSON.stringify({ a: address.toLowerCase(), exp: now + ttl }));
  return `${payload}.${sign(payload, secret)}`;
}

/** -> { address, exp } for a good, unexpired token; otherwise null. */
export function readToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > 400) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const { a, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof a === "string" && Number.isFinite(exp) && exp > now ? { address: a, exp } : null;
  } catch {
    return null;
  }
}

/** Does this wallet hold a Dojo Pass? Asks Monad's own RPC (never the visitor). */
export async function holdsPass(address, { fetchImpl = fetch, rpcs = MONAD.rpcs } = {}) {
  let last = "rpc";
  for (const url of rpcs) {
    try {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: PASS, data: PASS_HOLDER_SEL + address.toLowerCase().replace(/^0x/, "").padStart(64, "0") }, "latest"],
        }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return /[1-9a-f]/i.test(String(j.result || "").slice(2));
    } catch (e) {
      last = String(e.message || e).slice(0, 60);
    }
  }
  throw new Error(`could not check the pass on Monad (${last})`);
}

export function createPerks({ env = process.env, now = () => Date.now(), secret, hasPass = holdsPass } = {}) {
  const key = secret || (env.PERKS_SECRET || "").trim() || crypto.randomBytes(32).toString("hex");
  const m = Number(env.PERK_QUOTE_MULTIPLIER);
  const multiplier = Number.isFinite(m) && m >= 1 && m <= 20 ? m : QUOTE_MULTIPLIER_DEFAULT;

  /** Read the token on a request: { address, exp } or null. */
  const fromReq = (req) => readToken(req.get?.("x-perk-token") ?? req.headers?.["x-perk-token"], key, now());

  /** Verify a signed claim and issue a token. Throws a plain-language Error on any problem. */
  async function claim({ address, issuedAt, signature }) {
    if (!ethers.isAddress(address || "")) throw new Error("That is not a wallet address.");
    const t = Date.parse(issuedAt);
    if (!Number.isFinite(t) || Math.abs(now() - t) > CLAIM_MAX_AGE_MS)
      throw new Error("That sign-in is too old. Please try again.");
    const msg = perksMessage(ethers.getAddress(address), issuedAt);
    let signer;
    try {
      signer = ethers.verifyMessage(msg, String(signature || ""));
    } catch {
      throw new Error("That signature is not valid.");
    }
    if (signer.toLowerCase() !== address.toLowerCase()) throw new Error("That signature is from a different wallet.");
    if (!(await hasPass(signer))) throw new Error("This wallet does not hold a Dojo Pass.");
    const exp = now() + TOKEN_TTL_MS;
    return { token: makeToken(signer, now(), key), address: signer, exp, multiplier };
  }

  const routes = {
    status: (req, res) => {
      const t = fromReq(req);
      res.json(t ? { active: true, address: t.address, exp: t.exp, multiplier } : { active: false });
    },
    claim: async (req, res) => {
      try {
        res.json(await claim(req.body || {}));
      } catch (e) {
        res.status(400).json({ error: String(e.message || e) });
      }
    },
  };
  return { claim, fromReq, multiplier, routes };
}
