import test from "node:test";
import assert from "node:assert/strict";
import { CHAINS } from "../src/dex/chains.js";
import {
  parseCommand,
  parseAmount,
  findCoin,
  helpLines,
  coinLines,
  planLines,
  swapResultLines,
  signalResultLines,
} from "../src/agent-terminal.js";

const TOKENS = CHAINS.base.tokens;
const p = (s) => parseCommand(s, TOKENS);
const swap = (s) => {
  const r = p(s);
  return r.kind === "swap" ? [r.amount, r.sell.symbol, r.buy.symbol] : r;
};

test("amounts: plain, commas, decimals, k, dollars; exact string maths", () => {
  assert.deepEqual(parseAmount("100"), { value: "100", usd: false });
  assert.deepEqual(parseAmount("1,000"), { value: "1000", usd: false });
  assert.deepEqual(parseAmount(".5"), { value: "0.5", usd: false });
  assert.deepEqual(parseAmount("2.5k"), { value: "2500", usd: false });
  assert.deepEqual(parseAmount("1.23456k"), { value: "1234.56", usd: false });
  assert.deepEqual(parseAmount("$50"), { value: "50", usd: true });
  assert.deepEqual(parseAmount("50$"), { value: "50", usd: true });
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount("1,00"), null);
});

test("coins: symbols in any case, common names, unknown -> null", () => {
  assert.equal(findCoin("aero", TOKENS).symbol, "AERO");
  assert.equal(findCoin("CBBTC", TOKENS).symbol, "cbBTC");
  assert.equal(findCoin("bitcoin", TOKENS).symbol, "cbBTC");
  assert.equal(findCoin("ether", TOKENS).symbol, "ETH");
  assert.equal(findCoin("$degen", TOKENS).symbol, "DEGEN");
  assert.equal(findCoin("dollars", TOKENS).symbol, "USDC");
  assert.equal(findCoin("notacoin", TOKENS), null);
});

test("the ways people ask for a swap all become the same plan", () => {
  assert.deepEqual(swap("swap 100 USDC to AERO"), ["100", "USDC", "AERO"]);
  assert.deepEqual(swap("100 usdc -> aero"), ["100", "USDC", "AERO"]);
  assert.deepEqual(swap("100 USDC → AERO"), ["100", "USDC", "AERO"]);
  assert.deepEqual(swap("convert 0.5 eth into usdc"), ["0.5", "ETH", "USDC"]);
  assert.deepEqual(swap("put $50 into ETH"), ["50", "USDC", "ETH"]);
  assert.deepEqual(swap("$50 into aero"), ["50", "USDC", "AERO"]);
  assert.deepEqual(swap("invest 1k usd in bitcoin"), ["1000", "USDC", "cbBTC"]);
  assert.deepEqual(swap("buy $50 of DEGEN"), ["50", "USDC", "DEGEN"]);
  assert.deepEqual(swap("buy $50 virtual"), ["50", "USDC", "VIRTUAL"]);
  assert.deepEqual(swap("buy VIRTUAL with 0.05 ETH"), ["0.05", "ETH", "VIRTUAL"]);
  assert.deepEqual(swap("buy eth with $25"), ["25", "USDC", "ETH"]);
  assert.deepEqual(swap("sell 0.1 ETH"), ["0.1", "ETH", "USDC"]);
  assert.deepEqual(swap("sell 500 aero for eth"), ["500", "AERO", "ETH"]);
  assert.deepEqual(swap("Swap 1,000 USDC to cbBTC!"), ["1000", "USDC", "cbBTC"]);
});

test("missing or unclear pieces get a question back, never a guess", () => {
  const r1 = p("swap usdc to aero");
  assert.equal(r1.kind, "error");
  assert.match(r1.message, /How much USDC/);
  const r2 = p("swap 100 usdc to aeroo");
  assert.match(r2.message, /don't know "aeroo"/);
  assert.match(r2.hint, /Did you mean AERO/);
  assert.match(p("buy 100 aero").message, /amount you pay/);
  assert.match(p("put 50 into eth").message, /of what/);
  assert.match(p("swap $100 ETH to AERO").message, /in ETH, not dollars/);
  assert.match(p("swap 1 usdc to usdc").message, /different coin/);
  assert.match(p("swap 1.1234567 usdc to eth").message, /6 decimals/);
  assert.match(p("sell 100 usdc").message, /for what/);
  assert.equal(p("make me rich").kind, "error");
});

test("the other commands", () => {
  assert.equal(p("help").kind, "help");
  assert.equal(p("?").kind, "help");
  assert.equal(p("hire").kind, "hire");
  assert.equal(p("Yes").kind, "hire");
  assert.equal(p("cancel").kind, "cancel");
  assert.equal(p("open").kind, "open");
  assert.equal(p("clear").kind, "clear");
  assert.equal(p("status").kind, "status");
  assert.deepEqual(p("coins aer"), { kind: "coins", filter: "aer" });
  assert.deepEqual(p("signal"), { kind: "signal", amountUsd: 100 });
  assert.deepEqual(p("signal $250"), { kind: "signal", amountUsd: 250 });
  assert.equal(p("signal $50000").kind, "error");
  assert.equal(p("   ").kind, "empty");
});

test("what the agent prints: help, coins, a plan", () => {
  assert.ok(helpLines("0.01").some((l) => l.text.includes("swap 100 USDC to AERO")));
  const all = coinLines(TOKENS);
  assert.match(all[0].text, /^118 coins on Base/);
  assert.match(coinLines(TOKENS, "aer")[1].text, /AERO/);
  assert.equal(coinLines(TOKENS, "zzzz")[0].cls, "warn");
  const plan = planLines(p("swap 100 USDC to AERO"), { price: "0.01", sources: ["0x", "1inch", "uniswap", "zerion"] });
  assert.equal(plan[0].text, "Plan: swap 100 USDC → AERO on Base.");
  assert.match(plan[1].text, /0x, 1inch, Uniswap, Zerion/);
  assert.match(plan[2].text, /0\.01 USDC/);
});

test("a swap result: best price, every source best first, the market read, and the Swap-tab hand-off", () => {
  const j = {
    mode: "swap",
    request: {
      sell: { symbol: "USDC", decimals: 6, amount: "100" },
      buy: { symbol: "AERO", decimals: 18 },
    },
    read: {
      regime: { state: "RISK-OFF", score: -5, markets: 5, of: 5, source: "Coinbase" },
      about: { symbol: "AERO", trend: "HOLD_SHORT", detail: "downtrend intact" },
      side: "buy",
      stance: "against",
    },
    quote: {
      source: "1inch",
      buyAmount: "261730000000000000000",
      minBuyAmount: "260420000000000000000",
      sources: [
        { source: "0x", buyAmount: "261500000000000000000" },
        { source: "zerion", error: "timed out" },
        { source: "1inch", buyAmount: "261730000000000000000" },
      ],
    },
  };
  const { lines, prefill } = swapResultLines(j);
  const text = lines.map((l) => l.text);
  assert.equal(text[0], "✓ Best price: 1inch");
  assert.ok(text.includes("  You get    ~261.73 AERO"));
  const rows = text.filter((t) => /^ {2}(1inch|0x|Zerion) /.test(t));
  assert.deepEqual(rows, ["  1inch     261.73 AERO", "  0x        261.5 AERO", "  Zerion    timed out"]);
  assert.ok(text.includes("Market: RISK-OFF (score -5, 5 of 5 markets · Coinbase)"));
  assert.ok(text.some((t) => t === "AERO: HOLD_SHORT — downtrend intact. This trade goes against the signal."));
  assert.deepEqual(prefill, { chainKey: "base", from: "USDC", to: "AERO", amount: "100" });
});

test("a signal result without a trade has no hand-off", () => {
  const r = signalResultLines({
    verdict: "WAIT",
    tone: "warn",
    price: "$1",
    regime: "x",
    seykota: "y",
    quote: null,
    note: "No trade.",
  });
  assert.equal(r.prefill, null);
  assert.equal(r.lines.at(-1).text, "No trade.");
});
