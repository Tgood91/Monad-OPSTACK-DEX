import test from "node:test";
import assert from "node:assert/strict";
import { id as keccak } from "ethers";
import {
  DOJO,
  SEL,
  decodeWarrior,
  decodeBool,
  decodeUint,
  petMood,
  daysSince,
  fmtMon,
  dojoView,
  dojoTx,
  loadDojo,
  ethCall,
} from "../src/dojo/dojo-core.js";
import { runDojoTx } from "../src/dojo/dojo-tx.js";

const w = (n) => BigInt(n).toString(16).padStart(64, "0");
const WARRIOR_HEX = "0x" + [1794015300, 1794015300, 1, 72, 50, 0, 1].map(w).join(""); // your real warrior on Monad
const NO_WARRIOR_HEX = "0x" + [0, 0, 0, 0, 0, 0, 0].map(w).join("");
const NOW = 1794015300 + 3 * 86400 + 100;

test("selectors for named functions match their keccak names", () => {
  assert.equal(SEL.purchasePass, keccak("purchasePass()").slice(0, 10));
  assert.equal(SEL.enterDojo, keccak("enterDojo()").slice(0, 10));
  assert.equal(SEL.warriors, keccak("warriors(address)").slice(0, 10));
});

test("decodes a warrior exactly as the contract returns it", () => {
  assert.deepEqual(decodeWarrior(WARRIOR_HEX), {
    birth: 1794015300,
    last: 1794015300,
    level: 1,
    vitality: 72,
    focus: 50,
    streak: 0,
    registered: true,
  });
  assert.equal(decodeWarrior(NO_WARRIOR_HEX).registered, false);
  assert.throws(() => decodeWarrior("0x"), /bad warrior data/);
});

test("decodes yes/no and numbers", () => {
  assert.equal(decodeBool("0x" + w(1)), true);
  assert.equal(decodeBool("0x" + w(0)), false);
  assert.equal(decodeBool("0x"), false);
  assert.equal(decodeUint("0x" + w(10n ** 15n)), 10n ** 15n);
});

test("mood follows the Vitality meter, days and money format", () => {
  assert.deepEqual([85, 72, 50, 10].map(petMood), ["Radiant", "Ready", "Steady", "Weary"]);
  assert.equal(daysSince(1000, 1000 + 2 * 86400 + 5), 2);
  assert.equal(fmtMon(10n ** 15n), "0.001");
  assert.equal(fmtMon(0n), "0");
});

const data = (over = {}) => ({ hasPass: true, fee: 10n ** 15n, warrior: decodeWarrior(WARRIOR_HEX), ...over });

test("not connected, loading and error states", () => {
  assert.equal(dojoView({ connected: false }).kind, "connect");
  assert.equal(dojoView({ connected: true, loading: true }).kind, "loading");
  assert.equal(dojoView({ connected: true, error: "Monad is not answering" }).kind, "error");
});

test("a wallet with a pass and a warrior sees its pet and no buy button", () => {
  const v = dojoView({ connected: true, data: data(), nowSec: NOW });
  assert.equal(v.kind, "ready");
  assert.equal(v.pass.has, true);
  assert.equal(v.pass.action, undefined);
  assert.equal(v.pet.registered, true);
  assert.equal(v.pet.level, 1);
  assert.equal(v.pet.mood, "Ready");
  assert.equal(v.pet.days, 3);
  assert.deepEqual(
    v.pet.meters.map((m) => [m.label, m.value, m.pct]),
    [
      ["Vitality", 72, 72],
      ["Focus", 50, 50],
    ],
  );
});

test("the pass and the warrior are independent: any combination works", () => {
  const noPass = dojoView({ connected: true, data: data({ hasPass: false }), nowSec: NOW });
  assert.equal(noPass.pass.action.id, "pass");
  assert.match(noPass.pass.action.label, /0\.001 MON/);
  assert.equal(noPass.pet.registered, true); // a warrior without a pass is fine
  const noPet = dojoView({ connected: true, data: data({ warrior: decodeWarrior(NO_WARRIOR_HEX) }), nowSec: NOW });
  assert.equal(noPet.pet.registered, false);
  assert.equal(noPet.pet.action.id, "enter");
  assert.equal(noPet.pass.has, true); // a pass without a warrior is fine
  const neither = dojoView({
    connected: true,
    data: data({ hasPass: false, warrior: decodeWarrior(NO_WARRIOR_HEX) }),
    nowSec: NOW,
  });
  assert.equal(neither.pass.action.id, "pass");
  assert.equal(neither.pet.action.id, "enter");
});

test("button transactions: the pass sends its fee, entering sends none", () => {
  assert.deepEqual(dojoTx("pass", 10n ** 15n), { to: DOJO.pass, data: SEL.purchasePass, value: 10n ** 15n });
  assert.deepEqual(dojoTx("enter", 10n ** 15n), { to: DOJO.warrior, data: SEL.enterDojo, value: 0n });
  assert.throws(() => dojoTx("nope", 0n));
});

test("loadDojo reads the pass, the fee and the warrior in one go (fake RPC)", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const { params } = JSON.parse(init.body);
    const { to, data: d } = params[0];
    seen.push(d.slice(0, 10));
    const sel = d.slice(0, 10);
    const result = sel === SEL.passHolder ? "0x" + w(1) : sel === SEL.passFee ? "0x" + w(10n ** 15n) : WARRIOR_HEX;
    return { json: async () => ({ result }) };
  };
  const got = await loadDojo("0xBA397fAae1D5Fe10C0356f2e585bef34577ab111", { fetchImpl });
  assert.equal(got.hasPass, true);
  assert.equal(got.fee, 10n ** 15n);
  assert.equal(got.warrior.level, 1);
  assert.deepEqual(seen.sort(), [SEL.passFee, SEL.passHolder, SEL.warriors].sort());
});

test("ethCall falls back to the next RPC and then reports a clear error", async () => {
  let n = 0;
  const flaky = async () => {
    n++;
    if (n === 1) throw new Error("down");
    return { json: async () => ({ result: "0x01" }) };
  };
  assert.equal(await ethCall(DOJO.pass, "0x", { fetchImpl: flaky, rpcs: ["a", "b"] }), "0x01");
  await assert.rejects(
    ethCall(DOJO.pass, "0x", {
      fetchImpl: async () => {
        throw new Error("down");
      },
      rpcs: ["a"],
    }),
    /Monad is not answering/,
  );
});

function deps(over = {}) {
  const calls = [];
  return {
    calls,
    d: {
      chainId: 143,
      from: "0xUser",
      tx: { to: "0xP", data: "0x1", value: 5n },
      sleep: async () => {},
      getChainId: async () => {
        calls.push("chain?");
        return 143;
      },
      switchChain: async () => {
        calls.push("switch");
      },
      simulate: async () => {
        calls.push("simulate");
        return { ok: true };
      },
      send: async () => {
        calls.push("send");
        return {
          hash: "0xh",
          wait: async () => {
            calls.push("wait");
          },
        };
      },
      ...over,
    },
  };
}

test("button steps: dry-run before signing, then wait", async () => {
  const { d, calls } = deps();
  assert.equal((await runDojoTx(d)).hash, "0xh");
  assert.deepEqual(
    calls.filter((c) => c !== "chain?"),
    ["simulate", "send", "wait"],
  );
});

test("a wallet on another chain is switched to Monad first", async () => {
  let id = 8453;
  const { d, calls } = deps({
    getChainId: async () => id,
    switchChain: async () => {
      calls.push("switch");
      id = 143;
    },
  });
  await runDojoTx(d);
  assert.ok(calls.indexOf("switch") < calls.indexOf("simulate"));
});

test("a failed dry-run or a wallet that will not switch sends nothing", async () => {
  const bad = deps({ simulate: async () => ({ ok: false, reason: "revert" }) });
  await assert.rejects(runDojoTx(bad.d), /nothing was sent/);
  assert.equal(bad.calls.includes("send"), false);
  const stuck = deps({ getChainId: async () => 8453 });
  await assert.rejects(runDojoTx(stuck.d), /did not switch to Monad/);
  assert.equal(stuck.calls.includes("send"), false);
});
