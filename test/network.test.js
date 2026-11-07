import test from "node:test";
import assert from "node:assert/strict";
import { currentChainId } from "../src/utils/network.js";

test("reads the chain id from AppKit's getCaipNetwork (and works with no getNetwork at all)", () => {
  const kit = { getCaipNetwork: () => ({ id: 8453, caipNetworkId: "eip155:8453" }) };
  assert.equal(kit.getNetwork, undefined); // AppKit 1.8 really has no getNetwork()
  assert.equal(currentChainId(kit), 8453);
});

test("falls back to getChainId, accepts string ids, and returns null when unknown", () => {
  assert.equal(currentChainId({ getCaipNetwork: () => undefined, getChainId: () => "143" }), 143);
  assert.equal(currentChainId({ getCaipNetwork: () => undefined, getChainId: () => undefined }), null);
  assert.equal(currentChainId({}), null);
  assert.equal(currentChainId(undefined), null);
});
