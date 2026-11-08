import test from "node:test";
import assert from "node:assert/strict";
import { chainMenuItems, chainMenuLabel } from "../src/chain-menu.js";
import { CHAINS } from "../src/dex/chains.js";

test("the menu lists every chain, in table order, with the active one marked", () => {
  const items = chainMenuItems(CHAINS, "monad");
  assert.deepEqual(
    items.map((i) => i.value),
    Object.keys(CHAINS),
  );
  assert.equal(items.filter((i) => i.selected).length, 1);
  assert.equal(items.find((i) => i.selected).value, "monad");
  for (const i of items) {
    assert.ok(i.label && i.color, i.value);
  }
});
test("the new chains are in the menu", () => {
  const labels = chainMenuItems(CHAINS, "monad").map((i) => i.label);
  assert.ok(labels.includes("BNB Chain") && labels.includes("Avalanche"));
});
test("the button shows the active chain, and survives an unknown key", () => {
  assert.deepEqual(chainMenuLabel(CHAINS, "bsc"), { label: "BNB Chain", color: CHAINS.bsc.color });
  assert.equal(chainMenuLabel(CHAINS, "nope").label, Object.values(CHAINS)[0].label);
});
