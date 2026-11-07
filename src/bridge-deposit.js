// The "review before you pay" screen for a NEAR Intents bridge: wording, formatting, and an INDEPENDENT
// check of the deposit address. Pure helpers (no DOM, no wallet) so every rule is unit-tested.
//
// Why the check matters: the deposit address reaches the page through our server. Before the page lets you
// pay it, the browser asks NEAR's own status service (not our server) about that exact address and confirms
// NEAR recorded it with YOUR wallet as both the receiver and the refund address, for the amount you chose.

export const NEAR_STATUS_URL = 'https://1click.chaindefuser.com/v0/status?depositAddress=';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');
/** 0xB629DA4E… -> "0xB629 DA4E …" so a human can compare it piece by piece. */
export const chunkAddress = (a) => {
  const hex = String(a).replace(/^0x/i, '');
  return '0x ' + (hex.match(/.{1,4}/g) || []).join(' ');
};

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** "280000", 6 -> "0.28" (smallest units to a plain decimal string). */
export function formatUnits(atomic, decimals) {
  try {
    const s = BigInt(atomic)
      .toString()
      .padStart(decimals + 1, '0');
    const whole = s.slice(0, s.length - decimals);
    const frac = s.slice(s.length - decimals).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
  } catch {
    return null;
  }
}
const nice = (str) => {
  const n = Number(str);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(str);
};

export function hoursLeft(iso, nowMs = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (t - nowMs) / 3_600_000 : null;
}

/**
 * Compare NEAR's own record of this deposit address with what the user chose.
 * `record` is NEAR's /v0/status answer; `expected` = { depositAddress, wallet, amountAtomic, fromTokenAddress|null }.
 * Returns { ok, problems[], feeBps }.
 */
export function verifyIntent(record, expected, nowMs = Date.now()) {
  const problems = [];
  const req = record?.quoteResponse?.quoteRequest;
  const quote = record?.quoteResponse?.quote;
  if (!req || !quote) return { ok: false, problems: ['NEAR has no record of this deposit address'], feeBps: 0 };
  if (!same(quote.depositAddress, expected.depositAddress))
    problems.push('the address on screen is not the one NEAR issued');
  if (!same(req.recipient, expected.wallet)) problems.push('the receiving address is not your wallet');
  if (!same(req.refundTo, expected.wallet)) problems.push('the refund address is not your wallet');
  if (String(req.amount) !== String(expected.amountAtomic)) problems.push('the amount is not the one you chose');
  if (req.dry !== false) problems.push('this is not a live quote');
  if (req.swapType !== 'EXACT_INPUT') problems.push('unexpected swap type');
  if (
    req.depositType !== 'ORIGIN_CHAIN' ||
    req.refundType !== 'ORIGIN_CHAIN' ||
    req.recipientType !== 'DESTINATION_CHAIN'
  ) {
    problems.push('unexpected routing');
  }
  if (
    expected.fromTokenAddress &&
    !String(req.originAsset || '')
      .toLowerCase()
      .includes(expected.fromTokenAddress.toLowerCase())
  ) {
    problems.push('the token is not the one you chose');
  }
  const deadline = Date.parse(req.deadline);
  if (!Number.isFinite(deadline) || deadline <= nowMs) problems.push('the quote has expired');
  const feeBps = Array.isArray(req.appFees) ? req.appFees.reduce((n, f) => n + (Number(f.fee) || 0), 0) : 0;
  return { ok: problems.length === 0, problems, feeBps };
}

/**
 * Ask NEAR directly (not our server). A brand-new address can take a moment to appear, so a "not found"
 * answer is retried. Returns { state: 'verified' | 'mismatch' | 'unreachable', problems, feeBps }.
 */
export async function checkWithNear(
  expected,
  { fetchImpl = fetch, tries = 5, delayMs = 800, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), nowMs } = {},
) {
  let last = 'could not reach NEAR';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchImpl(NEAR_STATUS_URL + expected.depositAddress);
      if (r.ok) {
        const v = verifyIntent(await r.json(), expected, nowMs);
        return v.ok
          ? { state: 'verified', problems: [], feeBps: v.feeBps }
          : { state: 'mismatch', problems: v.problems, feeBps: v.feeBps };
      }
      last = r.status === 404 ? 'NEAR has not registered this address yet' : `NEAR answered ${r.status}`;
    } catch (e) {
      last = String(e?.message || e).slice(0, 80);
    }
    if (i < tries - 1) await sleep(delayMs);
  }
  return { state: 'unreachable', problems: [last], feeBps: 0 };
}

/** The short explanation of why the funds must already be in the wallet. */
export function whyPayFirst({ fromLabel, toLabel, gasSymbol }) {
  return (
    `A bridge doesn't move your coins. You pay the amount to the bridge on ${fromLabel}, and its liquidity providers ` +
    `pay you on ${toLabel} from their own funds. So the money, plus a little ${gasSymbol} for gas, has to be in your ` +
    `wallet on ${fromLabel} first. If anything goes wrong, it is refunded to the same wallet.`
  );
}

/** Everything the screen says, as plain strings. */
export function depositView({ intent, wallet, fromChain, toChain, nowMs = Date.now() }) {
  const { fi, ti } = intent;
  const minOut = intent.minAmountOut ? formatUnits(intent.minAmountOut, ti.decimals) : null;
  const refundFee = intent.refundFee != null ? formatUnits(intent.refundFee, fi.decimals) : null;
  const left = intent.deadline ? hoursLeft(intent.deadline, nowMs) : null;
  return {
    send: `${nice(intent.amountInFormatted)} ${fi.symbol}`,
    sendChain: fromChain.label,
    receive: `≈ ${nice(intent.amountOutFormatted)} ${ti.symbol}`,
    receiveChain: toChain.label,
    min: minOut ? `${nice(minOut)} ${ti.symbol}` : null,
    to: shortAddr(wallet),
    refund: `${shortAddr(wallet)} on ${fromChain.label}`,
    refundFee: refundFee && Number(refundFee) > 0 ? `about ${nice(refundFee)} ${fi.symbol}` : null,
    eta: intent.timeEstimateSec ? `about ${intent.timeEstimateSec} seconds` : 'under a minute',
    deadlineText:
      intent.deadline && left != null && left > 0
        ? `Send before ${new Date(intent.deadline).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} (${left >= 2 ? Math.round(left) + ' hours' : 'less than 2 hours'} left)`
        : null,
    tokenContract: fi.address || null,
    why: whyPayFirst({ fromLabel: fromChain.label, toLabel: toChain.label, gasSymbol: fromChain.native }),
  };
}
