import test from "node:test";
import assert from "node:assert/strict";
import { handleMcp, MCP_VERSIONS } from "../server/mcp.js";
import { agentConfig } from "../server/agent-job.js";

const cfg = agentConfig({});
const rpc = (method, params, id = 1) => handleMcp(cfg, { jsonrpc: "2.0", id, method, params });

test("initialize: agrees a protocol version and offers tools", () => {
  const r = rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  });
  assert.equal(r.result.protocolVersion, "2025-03-26");
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.result.serverInfo.name, "bushido-trades");
  assert.equal(rpc("initialize", { protocolVersion: "1999-01-01" }).result.protocolVersion, MCP_VERSIONS[0]);
});

test("notifications get no reply; ping answers", () => {
  assert.equal(handleMcp(cfg, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.deepEqual(rpc("ping").result, {});
});

test("tools/list has the two tools", () => {
  const names = rpc("tools/list").result.tools.map((t) => t.name);
  assert.deepEqual(names, ["prepare_swap_job", "list_base_coins"]);
});

test("prepare_swap_job returns the paid job and payment; bad input is a tool error", () => {
  const r = rpc("tools/call", { name: "prepare_swap_job", arguments: { sell: "USDC", buy: "AERO", amount: "25" } });
  assert.equal(r.result.isError, undefined);
  assert.deepEqual(r.result.structuredContent.hire.body, { sell: "USDC", buy: "AERO", amount: "25" });
  assert.equal(r.result.structuredContent.payment.network, "base");
  assert.match(r.result.content[0].text, /0\.01 USDC/);
  const bad = rpc("tools/call", { name: "prepare_swap_job", arguments: { sell: "NOPE", buy: "AERO", amount: "1" } });
  assert.equal(bad.result.isError, true);
});

test("list_base_coins lists and filters", () => {
  const all = rpc("tools/call", { name: "list_base_coins", arguments: {} }).result.structuredContent.coins;
  assert.ok(all.length > 100);
  const f = rpc("tools/call", { name: "list_base_coins", arguments: { search: "aero" } }).result.structuredContent
    .coins;
  assert.ok(f.every((c) => c.symbol.toLowerCase().includes("aero")) && f.length >= 1);
});

test("errors", () => {
  assert.equal(handleMcp(cfg, { nope: 1 }).error.code, -32600);
  assert.equal(rpc("resources/list").error.code, -32601);
  assert.equal(rpc("tools/call", { name: "nope" }).error.code, -32602);
});
