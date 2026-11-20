// Agent tab, pure helpers (unit-tested): the x402 payment the wallet signs, the agent's status, and how a job
// result is shown.
//
// Hiring Bushido-Trades is paid with a signature, not a transaction: the wallet signs a USDC
// "TransferWithAuthorization" (EIP-3009) for exactly the job price to the agent's payTo address. The server
// collects it on Base only after the job has run, so a failed job costs nothing. The requirements (price,
// payTo, USDC contract) always come from the server's answer, never from here.

export const BASE_CHAIN_ID = 8453;

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const SOURCE_NAMES = { '0x': '0x', '1inch': '1inch', uniswap: 'Uniswap', zerion: 'Zerion' };
export const sourceName = (s) => SOURCE_NAMES[s] || String(s);

/** Refuse anything that is not the payment this tab knows how to sign. */
export function checkRequirements(req) {
  if (!req) return 'The agent did not say how to pay.';
  if (req.scheme !== 'exact' || req.network !== 'base') return 'The agent asked for a payment this app cannot sign.';
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(req.payTo || '')) || !/^0x[0-9a-fA-F]{40}$/.test(String(req.asset || '')))
    return 'The agent sent a bad payment address.';
  if (!/^\d+$/.test(String(req.maxAmountRequired || '')) || BigInt(req.maxAmountRequired) <= 0n)
    return 'The agent sent a bad price.';
  // A runaway price is refused here, not just shown: 1 USDC is 100x the advertised job price.
  if (BigInt(req.maxAmountRequired) > 1_000_000n) return 'The agent asked for more than 1 USDC; not signing.';
  return null;
}

/** The authorization to sign. `now` in seconds, `nonce` a 0x-prefixed 32-byte hex string. */
export function buildAuthorization({ from, req, now, nonce }) {
  return {
    from,
    to: req.payTo,
    value: String(req.maxAmountRequired),
    validAfter: String(now - 600), // a little slack for clock skew, as the x402 reference client does
    validBefore: String(now + Number(req.maxTimeoutSeconds || 300)),
    nonce,
  };
}

/** EIP-712 domain, types and message for signTypedData. */
export function typedData(req, auth) {
  return {
    domain: {
      name: req.extra?.name || 'USD Coin',
      version: req.extra?.version || '2',
      chainId: BASE_CHAIN_ID,
      verifyingContract: req.asset,
    },
    types: TYPES,
    message: auth,
  };
}

/** The X-PAYMENT header value: base64 of the x402 v1 payment payload. */
export function paymentHeader(req, auth, signature) {
  const payload = {
    x402Version: 1,
    scheme: req.scheme,
    network: req.network,
    payload: { signature, authorization: auth },
  };
  const json = JSON.stringify(payload);
  return typeof btoa === 'function' ? btoa(json) : Buffer.from(json).toString('base64');
}

/** Raw token amount -> short decimal string. */
export function fmtUnits(raw, decimals, places = 6) {
  if (raw == null || raw === '') return '—';
  const v = BigInt(String(raw));
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').slice(0, places).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** The server's info answer -> can the visitor hire right now, and what to say. */
export function describeStatus(info) {
  const price = info?.accepts?.[0] ? fmtUnits(info.accepts[0].maxAmountRequired, 6) : null;
  if (!info) return { canHire: false, tone: 'error', chip: 'Offline', text: 'The agent is not answering right now.' };
  if (info.payments === 'enabled') return { canHire: true, tone: 'success', chip: 'Taking jobs', text: '', price };
  if (info.payments === 'paused')
    return { canHire: false, tone: 'warn', chip: 'Paused', text: info.note || 'Hiring is paused.', price };
  return { canHire: false, tone: 'warn', chip: 'Off', text: info.note || 'The agent is not taking payments.', price };
}

/** The agent's opening message, built from what the server says it does (no made-up claims). */
export function greeting(info) {
  const price = info?.accepts?.[0] ? fmtUnits(info.accepts[0].maxAmountRequired, 6) : '?';
  const src = (info?.agent?.sources || []).map(sourceName);
  const where = src.length ? ` across ${src.join(', ')}` : '';
  return (
    `I'm ${info?.agent?.name || 'Bushido-Trades'}. Hire me for ${price} USDC and I'll read the Druckenmiller ` +
    `macro regime and the Seykota trend for ETH, then quote that trade on Base${where} and give you the best price. ` +
    `You sign the payment (no gas). It is only collected after I've done the job.`
  );
}

const TOKENS = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '0x4200000000000000000000000000000000000006': { symbol: 'ETH', decimals: 18 },
};
const tok = (a) => TOKENS[String(a || '').toLowerCase()] || { symbol: '?', decimals: 18 };

/** A job result -> what the window shows, plus how to open the trade in the Swap tab. */
export function describeResult(j) {
  const s = j.signal || {};
  const out = {
    verdict: s.verdict || '—',
    direction: s.direction || 'none',
    tone: s.direction === 'long' ? 'success' : s.direction === 'short' ? 'error' : 'warn',
    regime: s.druckenmiller ? `${s.druckenmiller.regime} (score ${s.druckenmiller.regimeScore})` : '—',
    seykota: s.seykota ? `${s.seykota.signal}${s.seykota.detail ? ` — ${s.seykota.detail}` : ''}` : '—',
    price: Number.isFinite(s.priceUsd) ? `$${s.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—',
    gate: s.virtueGate?.status || '—',
    quote: null,
    prefill: null,
    note: j.note || '',
    paymentTx: j.payment?.transaction || null,
    paymentPending: Boolean(j.payment?.pending),
  };
  const q = j.quote;
  if (q) {
    const a = tok(q.sellToken);
    const b = tok(q.buyToken);
    const sell = fmtUnits(q.sellAmount, a.decimals);
    out.quote = {
      side: q.side,
      sell: `${sell} ${a.symbol}`,
      buy: `${fmtUnits(q.buyAmount, b.decimals)} ${b.symbol}`,
      min: q.minBuyAmount ? `${fmtUnits(q.minBuyAmount, b.decimals)} ${b.symbol}` : null,
      source: sourceName(q.source),
      // Every source's answer, best first; failures say why.
      sources: (q.sources || [])
        .map((x) =>
          x.error
            ? { name: sourceName(x.source), text: x.error, ok: false }
            : {
                name: sourceName(x.source),
                text: `${fmtUnits(x.buyAmount, b.decimals)} ${b.symbol}`,
                ok: true,
                raw: BigInt(x.buyAmount),
              },
        )
        .sort((x, y) => (x.ok && y.ok ? (y.raw > x.raw ? 1 : y.raw < x.raw ? -1 : 0) : x.ok ? -1 : y.ok ? 1 : 0))
        .map(({ name, text, ok }) => ({ name, text, ok })),
    };
    out.prefill = { chainKey: 'base', from: a.symbol, to: b.symbol, amount: sell };
  }
  return out;
}

/** HTML-escape text for the result bubble. */
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const row = (k, v) => `<div class="agent-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;

/** The agent's reply bubble for a finished job (every value escaped). */
export function resultHtml(v) {
  const sources = v.quote?.sources?.length
    ? `<div class="agent-sub">Every source asked</div>` +
      v.quote.sources
        .map(
          (s) =>
            `<div class="agent-row ${s.ok ? '' : 'agent-dim'}"><span>${esc(s.name)}</span><span>${esc(s.text)}</span></div>`,
        )
        .join('')
    : '';
  const quote = v.quote
    ? `<div class="agent-sub">Best quote on Base: ${esc(v.quote.source)}</div>` +
      row('You sell', v.quote.sell) +
      row('You get about', v.quote.buy) +
      (v.quote.min ? row('At least', v.quote.min) : '') +
      sources +
      '<button class="btn btn-secondary agent-open">Open in Swap (dry-run first)</button>'
    : `<div class="agent-note">${esc(v.note || 'No trade suggested right now.')}</div>`;
  const tx = v.paymentTx
    ? `<a class="agent-tx" href="https://basescan.org/tx/${encodeURIComponent(v.paymentTx)}" target="_blank" rel="noopener">` +
      `Payment on Basescan${v.paymentPending ? ' (confirming)' : ''} ↗</a>`
    : '';
  return (
    `<div class="agent-verdict ${v.tone}">${esc(v.verdict)}</div>` +
    row('ETH price', v.price) +
    row('Druckenmiller regime', v.regime) +
    row('Seykota trend', v.seykota) +
    row('Virtue gate', v.gate) +
    quote +
    tx
  );
}
