// Agent terminal: what people type to Bushido-Trades, and what it prints back (pure, unit-tested).
//
// People say which coin they want their money in ("swap 100 USDC to AERO", "put $50 into ETH"). The terminal
// reads it against the verified Base coin list (src/dex/chains.js), shows the plan, and only after "hire" asks
// for the 0.01 USDC payment. Nothing here guesses: an unknown coin or a missing amount gets a question back.

import { fmtUnits, sourceName } from './agent-core.js';

const USD_COINS = new Set(['USDC', 'USDT', 'DAI', 'USDbC']);
const ALIASES = {
  ether: 'ETH',
  ethereum: 'ETH',
  weth: 'ETH',
  btc: 'cbBTC',
  bitcoin: 'cbBTC',
  usd: 'USDC',
  dollar: 'USDC',
  dollars: 'USDC',
  bucks: 'USDC',
  tether: 'USDT',
};
const SWAP_VERB = '(?:swap|convert|trade|exchange|change|turn|move)';
const AMT = '(\\$?[\\d.,]+k?\\$?)';
const COIN = '([a-z0-9$][\\w.$-]*)';
const USD_WORD = '(?: (?:usd|usdc|dollars?|bucks))?';

/** A coin from the list by symbol (any case) or a common name; null if unknown. */
export function findCoin(word, tokens) {
  const w = String(word || '')
    .trim()
    .replace(/^\$(?=[a-z])/i, '');
  if (!w) return null;
  const lw = w.toLowerCase();
  const exact = tokens.find((t) => t.symbol.toLowerCase() === lw);
  if (exact) return exact;
  const alias = ALIASES[lw];
  return alias ? tokens.find((t) => t.symbol === alias) || null : null;
}

/** Up to n symbols that start like `word` (for "did you mean"). */
export function suggestCoins(word, tokens, n = 4) {
  const lw = String(word || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (lw.length < 2) return [];
  return tokens
    .filter((t) => t.symbol.toLowerCase().startsWith(lw.slice(0, 2)))
    .slice(0, n)
    .map((t) => t.symbol);
}

/** "100", "1,000", "0.5", ".5", "2.5k", "$100", "100$" -> { value: "100", usd } or null. Exact (string maths). */
export function parseAmount(raw) {
  let s = String(raw || '')
    .trim()
    .toLowerCase();
  let usd = false;
  if (s.startsWith('$')) [usd, s] = [true, s.slice(1)];
  if (s.endsWith('$')) [usd, s] = [true, s.slice(0, -1)];
  let thousands = false;
  if (s.endsWith('k')) [thousands, s] = [true, s.slice(0, -1)];
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/.test(s) || s === '' || s === '.') return null;
  s = s.replace(/,/g, '');
  let [int = '', frac = ''] = s.split('.');
  if (thousands) {
    frac = frac.padEnd(3, '0');
    [int, frac] = [int + frac.slice(0, 3), frac.slice(3)];
  }
  int = int.replace(/^0+(?=\d)/, '') || '0';
  frac = frac.replace(/0+$/, '');
  const value = frac ? `${int}.${frac}` : int;
  if (!/[1-9]/.test(value)) return null;
  return { value, usd };
}

const err = (message, hint) => ({ kind: 'error', message, hint });

function unknownCoin(word, tokens) {
  const s = suggestCoins(word, tokens);
  return err(
    `I don't know "${word}" on Base.`,
    s.length ? `Did you mean ${s.join(', ')}? Type coins to see them all.` : 'Type coins to see the list.',
  );
}

/** Build a swap plan, or an error that says what is missing. */
function swapPlan(amountRaw, sellWord, buyWord, tokens) {
  const amt = parseAmount(amountRaw);
  if (!amt) return err(`I couldn't read "${amountRaw}" as an amount.`, 'Try: swap 100 USDC to AERO');
  const sell = sellWord ? findCoin(sellWord, tokens) : findCoin('USDC', tokens);
  if (!sell) return unknownCoin(sellWord, tokens);
  const buy = findCoin(buyWord, tokens);
  if (!buy) return unknownCoin(buyWord, tokens);
  if (amt.usd && !USD_COINS.has(sell.symbol))
    return err(`Give the amount in ${sell.symbol}, not dollars.`, `e.g. swap 0.05 ${sell.symbol} to ${buy.symbol}`);
  if (sell.symbol === buy.symbol)
    return err(`That's ${sell.symbol} to ${sell.symbol}. Pick a different coin to swap into.`);
  const frac = amt.value.split('.')[1] || '';
  if (frac.length > sell.decimals) return err(`${sell.symbol} has only ${sell.decimals} decimals.`);
  return { kind: 'swap', sell, buy, amount: amt.value };
}

/** What did they ask for? Returns { kind, ... }. */
export function parseCommand(input, tokens) {
  const raw = String(input || '').trim();
  if (!raw) return { kind: 'empty' };
  const t = raw
    .toLowerCase()
    .replace(/→|⇒|->|=>/g, ' to ')
    .replace(/[?!]+$/, '')
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(help|commands|what can you do)$/.test(t) || /^\?+$/.test(raw)) return { kind: 'help' };
  if (/^(clear|cls)$/.test(t)) return { kind: 'clear' };
  if (/^(status|price)$/.test(t)) return { kind: 'status' };
  if (/^(hire|hire you|hire it|yes|y|go|run|confirm|ok|do it)$/.test(t)) return { kind: 'hire' };
  if (/^(cancel|no|n|stop|never ?mind)$/.test(t)) return { kind: 'cancel' };
  if (/^(open|open in swap|swap tab)$/.test(t)) return { kind: 'open' };
  let m;
  if ((m = t.match(/^(?:coins|list|tokens)(?: (.+))?$/))) return { kind: 'coins', filter: m[1] || '' };
  if ((m = t.match(/^signal(?: (?:for )?(\S+))?$/))) {
    if (!m[1]) return { kind: 'signal', amountUsd: 100 };
    const a = parseAmount(m[1]);
    const n = a ? Number(a.value) : NaN;
    if (!(n >= 1 && n <= 10000)) return err('The signal job takes $1 to $10,000.', 'e.g. signal $100');
    return { kind: 'signal', amountUsd: n };
  }
  // swap 100 usdc to aero · 100 usdc -> aero · convert 0.5 eth into usdc
  if ((m = t.match(new RegExp(`^(?:${SWAP_VERB} )?${AMT} ${COIN} (?:to|into|for|in) ${COIN}$`))))
    return swapPlan(m[1], m[2], m[3], tokens);
  // put $50 into aero · $50 into aero · invest 50 usd in eth
  if (
    (m = t.match(
      new RegExp(`^(?:(?:put|invest|spend|swap|convert|move) )?${AMT}${USD_WORD} (?:into|in|on|to|for|of) ${COIN}$`),
    ))
  ) {
    const a = parseAmount(m[1]);
    const usdWord = /(usd|usdc|dollars?|bucks)\b/.test(t);
    if (a && !a.usd && !usdWord)
      return err(
        `${m[1]} of what?`,
        `e.g. put $${a.value} into ${m[2].toUpperCase()} · swap ${a.value} USDC to ${m[2].toUpperCase()}`,
      );
    return swapPlan(m[1].includes('$') ? m[1] : `$${m[1]}`, null, m[2], tokens);
  }
  // buy $50 of aero · buy $50 aero · buy 50 usd of eth
  if ((m = t.match(new RegExp(`^buy ${AMT}${USD_WORD} (?:worth of |of )?${COIN}$`)))) {
    const a = parseAmount(m[1]);
    const usdWord = /^buy \S+ (usd|usdc|dollars?|bucks)\b/.test(t);
    if (a && !a.usd && !usdWord)
      return err(
        'I swap from an amount you pay, not an amount you get.',
        `Try: buy $${a.value} of ${m[2].toUpperCase()} · buy ${m[2].toUpperCase()} with ${a.value} USDC`,
      );
    return swapPlan(m[1].includes('$') ? m[1] : `$${m[1]}`, null, m[2], tokens);
  }
  // buy aero with 100 usdc · buy eth with $50 · buy virtual using 0.05 eth
  if ((m = t.match(new RegExp(`^buy ${COIN} (?:with|using|for) ${AMT}(?: ${COIN})?$`)))) {
    if (!m[3] && !m[2].includes('$'))
      return err(`${m[2]} of what?`, `e.g. buy ${m[1].toUpperCase()} with ${m[2]} USDC`);
    return swapPlan(m[2], m[3] || null, m[1], tokens);
  }
  // sell 0.1 eth · sell 0.1 eth for usdc · sell 500 aero to eth
  if ((m = t.match(new RegExp(`^sell ${AMT} ${COIN}(?: (?:for|to|into|in) ${COIN})?$`)))) {
    const target = m[3] || 'usdc';
    if (!m[3] && findCoin(m[2], tokens)?.symbol === 'USDC')
      return err('Sell USDC for what?', 'e.g. sell 100 USDC for ETH');
    return swapPlan(m[1], m[2], target, tokens);
  }
  // A swap with no amount: ask how much.
  if (
    (m = t.match(
      new RegExp(`^(?:${SWAP_VERB}|sell|buy|put) (?:all |all my |my |some )?${COIN} (?:to|into|for|in) ${COIN}$`),
    ))
  ) {
    const sell = findCoin(m[1], tokens);
    const buy = findCoin(m[2], tokens);
    if (!sell) return unknownCoin(m[1], tokens);
    if (!buy) return unknownCoin(m[2], tokens);
    return err(`How much ${sell.symbol}?`, `e.g. swap 100 ${sell.symbol} to ${buy.symbol}`);
  }
  return err("I didn't catch that.", 'Try: swap 100 USDC to AERO · put $50 into ETH · help');
}

/* ---------------- what the agent prints ---------------- */

const line = (text, cls = '') => ({ text, cls });

export function helpLines(price = '0.01') {
  return [
    line('Tell me which coin you want your money in. For example:'),
    line('  swap 100 USDC to AERO', 'cmd'),
    line('  put $50 into ETH', 'cmd'),
    line('  buy VIRTUAL with 0.05 ETH', 'cmd'),
    line('  sell 0.1 ETH            (into USDC)', 'cmd'),
    line('  signal $100             (I pick the ETH direction)', 'cmd'),
    line('Also: coins [search] · status · open · cancel · clear', 'dim'),
    line(`Each job costs ${price} USDC. You sign the payment (no gas); it's only collected after the job runs.`, 'dim'),
  ];
}

export function coinLines(tokens, filter = '') {
  const f = String(filter).trim().toLowerCase();
  const list = f ? tokens.filter((t) => t.symbol.toLowerCase().includes(f)) : tokens;
  if (!list.length) return [line(`No coin on Base matches "${filter}".`, 'warn')];
  const n = `${list.length} coin${list.length === 1 ? '' : 's'}`;
  const head = f ? `${n} matching "${filter}":` : `${n} on Base:`;
  const out = [line(head)];
  const syms = list.map((t) => t.symbol);
  for (let i = 0; i < syms.length; i += 8) out.push(line('  ' + syms.slice(i, i + 8).join('  '), 'cmd'));
  return out;
}

export function planLines(plan, { price = '0.01', sources = [] } = {}) {
  const where = sources.length ? sources.map(sourceName).join(', ') : 'every quote source';
  const head =
    plan.kind === 'signal'
      ? `Plan: read the ETH signal and quote a $${plan.amountUsd.toLocaleString()} trade in its direction on Base.`
      : `Plan: swap ${plan.amount} ${plan.sell.symbol} → ${plan.buy.symbol} on Base.`;
  return [
    line(head, 'ok'),
    line(`I'll read the market, ask ${where}, and give you the best price.`),
    line(`Cost: ${price} USDC (a signature, no gas). Type hire to run it, or cancel.`, 'dim'),
  ];
}

const STANCE = {
  with: 'This trade goes with the signal.',
  against: 'This trade goes against the signal.',
  unclear: 'The signal gives no clear direction.',
};

function regimeLine(r) {
  if (!r) return null;
  const src = r.source ? ` · ${r.source}` : '';
  return line(`Market: ${r.state} (score ${r.score}, ${r.markets} of ${r.of} markets${src})`);
}

function sourceRows(quote, decimals, symbol) {
  const rows = (quote.sources || [])
    .map((s) =>
      s.error
        ? { name: sourceName(s.source), text: s.error, ok: false, raw: -1n }
        : {
            name: sourceName(s.source),
            text: `${fmtUnits(s.buyAmount, decimals)} ${symbol}`,
            ok: true,
            raw: BigInt(s.buyAmount),
          },
    )
    .sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0));
  return rows.map((r) => line(`  ${r.name.padEnd(9)} ${r.text}`, r.ok ? 'cmd' : 'dim'));
}

/** A finished swap job -> lines, and how to open it in the Swap tab. */
export function swapResultLines(j) {
  const { sell, buy } = j.request;
  const q = j.quote;
  const out = [
    line(`✓ Best price: ${sourceName(q.source)}`, 'ok'),
    line(`  You sell   ${sell.amount} ${sell.symbol}`),
    line(`  You get    ~${fmtUnits(q.buyAmount, buy.decimals)} ${buy.symbol}`),
  ];
  if (q.minBuyAmount) out.push(line(`  At least   ${fmtUnits(q.minBuyAmount, buy.decimals)} ${buy.symbol}`));
  if ((q.sources || []).length > 1)
    out.push(line('Every source asked:', 'dim'), ...sourceRows(q, buy.decimals, buy.symbol));
  const r = regimeLine(j.read?.regime);
  if (r) out.push(r);
  const a = j.read?.about;
  if (a)
    out.push(line(`${a.symbol}: ${a.trend}${a.detail ? ` — ${a.detail}` : ''}. ${STANCE[j.read.stance] || ''}`.trim()));
  else out.push(line(`No trend model for ${buy.symbol}; the market line above is the backdrop.`, 'dim'));
  out.push(line('Type open to put it in the Swap tab (it gets a dry run before you sign).', 'dim'));
  return { lines: out, prefill: { chainKey: 'base', from: sell.symbol, to: buy.symbol, amount: sell.amount } };
}

/** A finished ETH-signal job -> lines, and how to open it in the Swap tab (when there is a trade). */
export function signalResultLines(v) {
  const out = [
    line(`✓ ${v.verdict}`, v.tone === 'success' ? 'ok' : v.tone === 'error' ? 'err' : 'warn'),
    line(`  ETH price   ${v.price}`),
    line(`  Regime      ${v.regime}`),
    line(`  Trend       ${v.seykota}`),
  ];
  if (!v.quote) return { lines: [...out, line(v.note || 'No trade suggested right now.', 'warn')], prefill: null };
  out.push(
    line(`Best price: ${v.quote.source}`, 'ok'),
    line(`  You sell   ${v.quote.sell}`),
    line(`  You get    ~${v.quote.buy}`),
  );
  if (v.quote.min) out.push(line(`  At least   ${v.quote.min}`));
  out.push(line('Type open to put it in the Swap tab (it gets a dry run before you sign).', 'dim'));
  return { lines: out, prefill: v.prefill };
}
