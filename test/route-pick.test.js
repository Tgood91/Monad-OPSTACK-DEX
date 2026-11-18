// Route choice on the swap screen: best quote, Velora preference within 0.20%, and the user's own pick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VELORA_PREFER_THRESHOLD_BPS, pickRoute, preferenceLabel, feeLine } from "../src/dex/route-pick.js";

const q = (source, amountOut) => ({ source, ok: true, quote: { source, amountOut } });
const rank = (good) => [...good].sort((a, b) => (a.quote.amountOut < b.quote.amountOut ? 1 : -1));

test("the threshold is 20 bps (0.20%)", () => {
  assert.equal(VELORA_PREFER_THRESHOLD_BPS, 20);
});

test("Velora within 0.20% of the best is picked, and labelled with how far behind it is", () => {
  const good = rank([q("kyberswap", 1_000_000n), q("velora", 998_500n), q("lifi", 990_000n)]);
  const c = pickRoute(good, good[0], null);
  assert.equal(c.pick.source, "velora");
  assert.equal(c.why, "velora-preferred");
  assert.equal(c.behindBps, 15);
  assert.equal(
    preferenceLabel(c),
    "Velora route (within 0.2% of best; this quote is 0.15% below it) · includes 0.25% partner fee",
  );
});

test("exactly at the threshold still prefers Velora; one unit past it does not", () => {
  const at = rank([q("zerox", 1_000_000n), q("velora", 998_000n)]);
  assert.equal(pickRoute(at, at[0], null).pick.source, "velora");
  const past = rank([q("zerox", 1_000_000n), q("velora", 997_999n)]);
  const c = pickRoute(past, past[0], null);
  assert.equal(c.pick.source, "zerox");
  assert.equal(c.why, "best");
  assert.equal(preferenceLabel(c), "");
});

test("when Velora is the best it is simply the best: no extra label", () => {
  const good = rank([q("velora", 1_000_000n), q("kyberswap", 999_000n)]);
  const c = pickRoute(good, good[0], null);
  assert.equal(c.pick.source, "velora");
  assert.equal(c.why, "best");
  assert.equal(preferenceLabel(c), "");
});

test("no Velora quote (e.g. a Monad pair it cannot serve): the best, as before", () => {
  const good = rank([q("kyberswap", 1_000_000n), q("lifi", 999_900n)]);
  const c = pickRoute(good, good[0], null);
  assert.equal(c.pick.source, "kyberswap");
  assert.equal(c.why, "best");
});

test("the user's own pick always wins, even over a preferred Velora quote", () => {
  const good = rank([q("kyberswap", 1_000_000n), q("velora", 999_000n), q("lifi", 990_000n)]);
  assert.equal(pickRoute(good, good[0], "lifi").pick.source, "lifi");
  assert.equal(pickRoute(good, good[0], "kyberswap").pick.source, "kyberswap");
  assert.equal(pickRoute(good, good[0], "lifi").why, "manual");
  assert.equal(preferenceLabel(pickRoute(good, good[0], "lifi")), "");
  // a pick whose source has no quote this time falls back to the default choice
  assert.equal(pickRoute(good, good[0], "oneinch").pick.source, "velora");
});

test("no quotes at all: nothing picked", () => {
  assert.equal(pickRoute([], null, null).pick, null);
});

test("fee line: sources that take the Bushido fee say so; the others say there is none", () => {
  for (const s of ["velora", "kyberswap", "zerox", "oneinch"]) assert.match(feeLine(s), /0\.25% Bushido fee/);
  for (const s of ["lifi", "uniswap", "zerion", "fusion"]) assert.equal(feeLine(s), "No Bushido fee on this route");
});

test("a tiny gap is not shown as 0.00%", () => {
  const good = rank([q("kyberswap", 90_927_824n), q("velora", 90_927_181n)]);
  const c = pickRoute(good, good[0], null);
  assert.equal(c.pick.source, "velora");
  assert.match(preferenceLabel(c), /less than 0\.01% below it/);
});
