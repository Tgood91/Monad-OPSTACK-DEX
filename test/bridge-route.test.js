import test from "node:test";
import assert from "node:assert/strict";
import { fromChainsAll, toChainsAll, providersFor, pickProvider } from "../src/bridge-route.js";

const SC = {
  near: ["base", "optimism", "ethereum", "monad"],
  stargate: ["ethereum", "base", "optimism", "arbitrum", "avalanche", "bsc"],
  aori: ["ethereum", "base", "optimism", "arbitrum", "monad", "bsc"],
};
const WITH_RELAY = {
  ...SC,
  relay: ["base", "optimism", "ethereum", "monad", "arbitrum", "avalanche", "bsc", "ink", "unichain"],
};
const NEAR_TO = ["bsc", "avalanche", "polygon", "scroll", "xlayer", "adi"];

test("From and To lists cover every provider", () => {
  assert.deepEqual(fromChainsAll(SC), ["base", "optimism", "ethereum", "monad", "arbitrum", "avalanche", "bsc"]);
  assert.ok(toChainsAll(SC, NEAR_TO).includes("polygon"));
  assert.equal(fromChainsAll(SC).includes("polygon"), false); // receive-only
});

test("providers that can carry a route, in preference order", () => {
  assert.deepEqual(providersFor("base", "monad", SC, NEAR_TO), ["near", "aori"]);
  assert.deepEqual(providersFor("base", "optimism", SC, NEAR_TO), ["near", "stargate", "aori"]);
  assert.deepEqual(providersFor("ethereum", "avalanche", SC, NEAR_TO), ["near", "stargate"]);
});

test("receive-only chains are NEAR-only, and unsupported routes have no provider", () => {
  assert.deepEqual(providersFor("base", "polygon", SC, NEAR_TO), ["near"]);
  assert.deepEqual(providersFor("arbitrum", "polygon", SC, NEAR_TO), []);
  assert.deepEqual(providersFor("polygon", "base", SC, NEAR_TO), []); // cannot pay from it
  assert.deepEqual(providersFor("base", "base", SC, NEAR_TO), []);
});

test("the current provider is kept when it still works, otherwise the first that does", () => {
  assert.equal(pickProvider("aori", ["near", "aori"]), "aori");
  assert.equal(pickProvider("stargate", ["near", "aori"]), "near");
  assert.equal(pickProvider("near", []), null);
});

test("Relay: listed before Aori, and the only provider for Ink and Unichain", () => {
  assert.deepEqual(providersFor("base", "monad", WITH_RELAY, NEAR_TO), ["near", "relay", "aori"]);
  assert.deepEqual(providersFor("base", "ink", WITH_RELAY, NEAR_TO), ["relay"]);
  assert.deepEqual(providersFor("ink", "unichain", WITH_RELAY, NEAR_TO), ["relay"]);
  assert.deepEqual(providersFor("avalanche", "monad", WITH_RELAY, NEAR_TO), ["relay"]);
  assert.ok(fromChainsAll(WITH_RELAY).includes("ink"));
  assert.equal(pickProvider("near", providersFor("base", "ink", WITH_RELAY, NEAR_TO)), "relay");
  assert.deepEqual(providersFor("ink", "polygon", WITH_RELAY, NEAR_TO), []); // Relay is not offered to the receive-only chains
});
