import test from "node:test";
import assert from "node:assert/strict";
import { agentCard, handleA2A, parseSwapText, A2A_PATH } from "../server/a2a.js";
import { agentConfig } from "../server/agent-job.js";

const cfg = agentConfig({});
const send = (parts, extra = {}) =>
  handleA2A(cfg, {
    jsonrpc: "2.0",
    id: 7,
    method: "message/send",
    params: { message: { role: "user", messageId: "m1", parts, ...extra } },
  });

test("agent card: A2A 0.3.0, JSON-RPC at /a2a, one paid skill", () => {
  const c = agentCard(cfg);
  assert.equal(c.protocolVersion, "0.3.0");
  assert.equal(c.url, "https://bushido-dapp.onrender.com" + A2A_PATH);
  assert.equal(c.preferredTransport, "JSONRPC");
  assert.equal(c.name, "Bushido-Trades");
  assert.equal(c.skills.length, 1);
  assert.match(c.skills[0].description, /0\.01 USDC/);
  assert.deepEqual(c.capabilities, { streaming: false, pushNotifications: false, stateTransitionHistory: false });
});

test("swap text is read", () => {
  assert.deepEqual(parseSwapText("swap 25 USDC to AERO"), { amount: "25", sell: "USDC", buy: "AERO" });
  assert.deepEqual(parseSwapText("0.5 ETH for USDC"), { amount: "0.5", sell: "ETH", buy: "USDC" });
  assert.equal(parseSwapText("hello"), null);
});

test("message/send with a swap answers with the job body and the x402 payment", () => {
  const r = send([{ kind: "text", text: "swap 25 USDC to AERO" }], { contextId: "c1" });
  assert.equal(r.id, 7);
  assert.equal(r.result.kind, "message");
  assert.equal(r.result.role, "agent");
  assert.equal(r.result.contextId, "c1");
  const data = r.result.parts.find((p) => p.kind === "data").data;
  assert.deepEqual(data.hire.body, { sell: "USDC", buy: "AERO", amount: "25" });
  assert.equal(data.hire.url, "https://bushido-dapp.onrender.com/api/agent/job");
  assert.equal(data.payment.network, "base");
});

test("a data part works too, and bad input is explained, not charged", () => {
  const ok = send([{ kind: "data", data: { sell: "USDC", buy: "AERO", amount: "10" } }]);
  assert.deepEqual(ok.result.parts[1].data.hire.body, { sell: "USDC", buy: "AERO", amount: "10" });
  const bad = send([{ kind: "text", text: "swap 5 NOPECOIN to AERO" }]);
  assert.match(bad.result.parts[0].text, /unknown coin/);
  const vague = send([{ kind: "text", text: "hi" }]);
  assert.match(vague.result.parts[0].text, /swap 25 USDC to AERO/);
});

test("JSON-RPC errors", () => {
  assert.equal(handleA2A(cfg, { foo: 1 }).error.code, -32600);
  assert.equal(handleA2A(cfg, { jsonrpc: "2.0", id: 1, method: "message/stream" }).error.code, -32601);
  assert.equal(handleA2A(cfg, { jsonrpc: "2.0", id: 1, method: "tasks/get", params: {} }).error.code, -32001);
  assert.equal(handleA2A(cfg, { jsonrpc: "2.0", id: 1, method: "message/send", params: {} }).error.code, -32602);
});
