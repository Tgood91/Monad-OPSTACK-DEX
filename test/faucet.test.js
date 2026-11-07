import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { createFaucet, faucetConfig, isPrivateIp } from "../server/faucet.js";

const KEY = "0x" + "11".repeat(32);
const FAUCET_ADDR = new ethers.Wallet(KEY).address;
const E = (n) => ethers.parseEther(String(n));
const A = (n) => ethers.getAddress("0x" + String(n).padStart(40, "0"));

function chain({ faucetMon = 5 } = {}) {
  const balances = new Map([[FAUCET_ADDR, E(faucetMon)]]);
  const nonces = new Map();
  const sent = [];
  let inFlight = 0,
    maxInFlight = 0;
  const provider = {
    getBalance: async (a) => balances.get(ethers.getAddress(a)) ?? 0n,
    getTransactionCount: async (a) => nonces.get(ethers.getAddress(a)) ?? 0,
  };
  const wallet = {
    sendTransaction: async ({ to, value }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      balances.set(FAUCET_ADDR, balances.get(FAUCET_ADDR) - value);
      balances.set(to, (balances.get(to) ?? 0n) + value);
      sent.push({ to, value });
      inFlight--;
      return { hash: "0xhash" + sent.length, wait: async () => ({}) };
    },
  };
  return {
    balances,
    nonces,
    sent,
    get maxInFlight() {
      return maxInFlight;
    },
    makeProvider: () => provider,
    makeWallet: () => wallet,
  };
}

function make(over = {}, chainOpts = {}) {
  const c = chain(chainOpts);
  const logs = [];
  let t = Date.UTC(2026, 10, 7, 12);
  const f = createFaucet({
    env: { FAUCET_PRIVATE_KEY: KEY, ...over },
    now: () => t,
    makeProvider: c.makeProvider,
    makeWallet: c.makeWallet,
    log: (e) => logs.push(e),
  });
  return { f, c, logs, nextDay: () => (t += 86400_000) };
}

test("off without a key (or with a bad one): says so, sends nothing", async () => {
  for (const env of [{}, { FAUCET_PRIVATE_KEY: "not-a-key" }, { FAUCET_PRIVATE_KEY: KEY, FAUCET_DISABLED: "1" }]) {
    const f = createFaucet({ env, makeProvider: () => assert.fail("no RPC when off") });
    assert.equal(f.enabled, false);
    assert.deepEqual(await f.status(A(1)), { enabled: false });
    await assert.rejects(f.claim(A(1), "8.8.8.8"), /not set up/);
  }
});

test("a wallet with no activity can claim exactly one drip", async () => {
  const { f, c } = make();
  const s = await f.status(A(1));
  assert.equal(s.enabled, true);
  assert.equal(s.eligible, true);
  assert.equal(s.available, true);
  assert.equal(s.dripMon, "0.05");
  assert.equal(s.faucet, FAUCET_ADDR);
  const r = await f.claim(A(1), "8.8.8.8");
  assert.equal(r.amountMon, "0.05");
  assert.deepEqual(c.sent, [{ to: A(1), value: E("0.05") }]);
});

test("one claim per wallet: after the drip it has MON, and spending it needs a transaction", async () => {
  const { f, c } = make();
  await f.claim(A(1), "8.8.8.8");
  await assert.rejects(f.claim(A(1), "9.9.9.9"), /already has MON/);
  c.balances.set(A(1), 0n); // spent it all...
  c.nonces.set(A(1), 3); // ...which took transactions
  await assert.rejects(f.claim(A(1), "7.7.7.7"), /already has activity/);
  assert.equal(c.sent.length, 1);
});

test("wallets with activity or enough MON are refused", async () => {
  const { f, c } = make();
  c.nonces.set(A(2), 1);
  c.balances.set(A(3), E("0.5"));
  assert.equal((await f.status(A(2))).eligible, false);
  assert.match((await f.status(A(2))).reason, /activity/);
  assert.match((await f.status(A(3))).reason, /MON for gas/);
  await assert.rejects(f.claim(A(2), "1.1.1.1"), /activity/);
  await assert.rejects(f.claim(A(3), "1.1.1.1"), /MON for gas/);
  assert.equal(c.sent.length, 0);
});

test("one claim per visitor per day; private/proxy addresses are not limited by IP", async () => {
  const { f, nextDay } = make();
  await f.claim(A(1), "8.8.8.8");
  await assert.rejects(f.claim(A(2), "8.8.8.8"), /one claim per visitor/i);
  await f.claim(A(3), "8.8.4.4"); // a different visitor is fine
  nextDay();
  await f.claim(A(2), "8.8.8.8"); // a new day resets it
  const priv = make();
  await priv.f.claim(A(1), "10.0.0.5");
  await priv.f.claim(A(2), "10.0.0.5"); // behind an unconfigured proxy every visitor looks the same: no IP limit
});

test("daily cap on total claims, reset the next day", async () => {
  const { f, nextDay } = make({ FAUCET_DAILY_CAP: "2" });
  await f.claim(A(1), "1.1.1.1");
  await f.claim(A(2), "2.2.2.2");
  await assert.rejects(f.claim(A(3), "3.3.3.3"), /daily limit/);
  assert.equal((await f.status(A(4))).available, false);
  nextDay();
  await f.claim(A(3), "3.3.3.3");
});

test("an empty faucet refuses, says so, and raises a high alert", async () => {
  const { f, logs, c } = make({}, { faucetMon: 0.1 }); // below drip + reserve
  assert.equal((await f.status(A(1))).available, false);
  await assert.rejects(f.claim(A(1), "8.8.8.8"), /empty/);
  assert.equal(c.sent.length, 0);
  assert.ok(logs.some((l) => l.severity === "high" && /out of MON/.test(l.message)));
});

test("it warns when the wallet is running low after a drip", async () => {
  const { f, logs } = make({}, { faucetMon: 0.62 }); // 0.57 left after a drip: under the "running low" line (0.6)
  await f.claim(A(1), "8.8.8.8");
  assert.ok(logs.some((l) => l.severity === "warn" && /running low/.test(l.message)));
});

test("simultaneous claims are sent one at a time", async () => {
  const { f, c } = make();
  await Promise.all([f.claim(A(1), "1.1.1.1"), f.claim(A(2), "2.2.2.2"), f.claim(A(3), "3.3.3.3")]);
  assert.equal(c.sent.length, 3);
  assert.equal(c.maxInFlight, 1);
});

test("bad addresses are rejected", async () => {
  const { f } = make();
  await assert.rejects(f.status("nope"), /bad address/);
  await assert.rejects(f.claim("0x123", "8.8.8.8"), /bad address/);
});

test("the private key never appears in any answer or log line", async () => {
  const { f, logs } = make();
  const out = JSON.stringify([await f.status(A(1)), await f.claim(A(1), "8.8.8.8"), logs, f.address]);
  assert.equal(out.includes(KEY.slice(2)), false);
  assert.equal(out.toLowerCase().includes("private"), false);
});

test("settings: defaults, custom values, bad values fall back", () => {
  const d = faucetConfig({ FAUCET_PRIVATE_KEY: KEY });
  assert.deepEqual([d.drip, d.minBalance, d.reserve, d.dailyCap], [E("0.05"), E("0.02"), E("0.1"), 100]);
  const c = faucetConfig({ FAUCET_PRIVATE_KEY: KEY, FAUCET_DRIP_MON: "0.1", FAUCET_DAILY_CAP: "5" });
  assert.deepEqual([c.drip, c.dailyCap], [E("0.1"), 5]);
  const bad = faucetConfig({ FAUCET_PRIVATE_KEY: KEY, FAUCET_DRIP_MON: "lots", FAUCET_DAILY_CAP: "-3" });
  assert.deepEqual([bad.drip, bad.dailyCap], [E("0.05"), 100]);
});

test("private and proxy addresses are recognised", () => {
  for (const ip of ["10.1.2.3", "::ffff:10.1.2.3", "172.16.0.9", "192.168.1.1", "127.0.0.1", "::1", "", undefined])
    assert.equal(isPrivateIp(ip), true, String(ip));
  for (const ip of ["8.8.8.8", "::ffff:8.8.4.4", "172.32.0.1"]) assert.equal(isPrivateIp(ip), false, ip);
});
