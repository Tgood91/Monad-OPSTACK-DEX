import test from "node:test";
import assert from "node:assert/strict";
import { errorStatus } from "../server/bridge-health.js";

test("a route that fails is down", () => {
  assert.equal(errorStatus(new Error("Aori 500 on /quote")), "down");
  assert.equal(errorStatus(new Error("stargate probe timed out")), "down");
});

test("a source that is not set up on this server is 'not configured', not down", () => {
  assert.equal(errorStatus(new Error("connect ENOENT /run/hatch/auth/authd.sock")), "unknown");
  assert.equal(errorStatus(new Error("ONEINCH_API_KEY not set")), "unknown");
  assert.equal(errorStatus(new Error("1inch rejected the API key (401)")), "unknown");
});
