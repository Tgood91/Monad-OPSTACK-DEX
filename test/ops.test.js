import test from "node:test";
import assert from "node:assert/strict";
import { logOps, recentOps, _resetOps } from "../server/ops.js";

const env = { RESEND_API_KEY: "re_test", ALERT_EMAIL_TO: "a@x.io, b@x.io" };

test("high severity emails via Resend once per message", async () => {
  _resetOps();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true };
  };
  const a = await logOps({ severity: "high", message: "RPC down" }, { env, fetchImpl, now: 1e12 });
  const b = await logOps({ severity: "high", message: "RPC down" }, { env, fetchImpl, now: 1e12 + 1000 });
  assert.equal(a.escalated, true);
  assert.equal(b.escalated, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.deepEqual(JSON.parse(calls[0].init.body).to, ["a@x.io", "b@x.io"]);
  assert.equal(recentOps().length, 2);
});

test("low severity and missing key never email", async () => {
  _resetOps();
  let n = 0;
  const fetchImpl = async () => {
    n++;
    return { ok: true };
  };
  await logOps({ severity: "warn", message: "x" }, { env, fetchImpl });
  await logOps({ severity: "high", message: "y" }, { env: {}, fetchImpl });
  assert.equal(n, 0);
});
