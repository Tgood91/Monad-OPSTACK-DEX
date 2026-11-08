import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// A stray </div> once closed the page's main wrapper right after the Connect row, pushing the tab bar and the whole
// app outside it (an 80px gap on phones, and no width limit on desktop). This pins the structure.
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const count = (s, re) => (s.match(re) || []).length;

test("the page wrapper is still open when the tab bar starts", () => {
  const head = html.slice(html.indexOf('<div class="container">'), html.indexOf('<div class="tab-bar">'));
  assert.ok(head.length > 0, "found the wrapper and the tab bar");
  // wrapper itself + subtitle + wallet bar open; subtitle and wallet bar close; the wrapper must NOT be closed yet
  assert.equal(count(head, /<div\b/g) - count(head, /<\/div>/g), 1);
});

test("the tab bar and the panes come after the wallet bar, inside the same wrapper", () => {
  const afterWallet = html.slice(html.indexOf('id="connectBtn"'));
  assert.ok(afterWallet.indexOf('<div class="tab-bar">') < afterWallet.indexOf('id="swapPane"'));
  assert.ok(afterWallet.indexOf('id="swapPane"') < afterWallet.indexOf('id="bridgePane"'));
});
