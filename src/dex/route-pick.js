// Which quote the swap screen uses, and the fee line it shows.
//
// Default pick: the best quote (most output), except that Velora is preferred when its quote is within
// VELORA_PREFER_THRESHOLD_BPS of the best, because Velora pays the Bushido partner fee straight to the fee
// wallet in the swap (src/dex/adapters.js). A source the user tapped always wins over both. The swap screen
// labels the Velora preference whenever it gives the user less than the best quote: never silent.
import { FEE_BPS, FEE_ENABLED } from './fee.js';

export const VELORA_PREFER_THRESHOLD_BPS = 20; // 0.20%: tune here, nowhere else

// Sources whose quote already has the Bushido fee taken out (src/dex/fee.js, server/fee.js).
const FEE_SOURCES = new Set(['velora', 'kyberswap', 'zerox', 'oneinch']);

/**
 * good: the quotes that came back (each { source, ok: true, quote: { amountOut } }); best: the one with the most
 * output; userPick: the source the user tapped, or null.
 * -> { pick, why: 'manual' | 'velora-preferred' | 'best', behindBps }  (pick is null when there are no quotes)
 */
export function pickRoute(good, best, userPick) {
  const manual = userPick ? good.find((r) => r.source === userPick) : null;
  if (manual) return { pick: manual, why: 'manual', behindBps: bpsBehind(manual, best) };
  if (!best) return { pick: null, why: 'best', behindBps: 0 };
  const v = good.find((r) => r.source === 'velora');
  if (
    v &&
    v !== best &&
    v.quote.amountOut * 10000n >= best.quote.amountOut * BigInt(10000 - VELORA_PREFER_THRESHOLD_BPS)
  ) {
    return { pick: v, why: 'velora-preferred', behindBps: bpsBehind(v, best) };
  }
  return { pick: best, why: 'best', behindBps: 0 };
}

/** How far a quote is below the best, in basis points (0 when it is the best). */
function bpsBehind(r, best) {
  if (!best || r === best || best.quote.amountOut <= 0n) return 0;
  return Number(((best.quote.amountOut - r.quote.amountOut) * 1000000n) / best.quote.amountOut) / 100;
}

const pct = (bps) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

/** The label shown under the route when the Velora preference is in effect; '' otherwise. */
export function preferenceLabel(choice) {
  if (choice.why !== 'velora-preferred') return '';
  const gap = choice.behindBps / 100; // percent
  const behind = gap < 0.01 ? 'less than 0.01% below it' : `${gap.toFixed(2)}% below it`;
  return (
    `Velora route (within ${pct(VELORA_PREFER_THRESHOLD_BPS)} of best; this quote is ${behind}) · ` +
    `includes ${pct(FEE_BPS)} partner fee`
  );
}

/** The fee line for a quote's details. */
export function feeLine(source) {
  if (FEE_ENABLED && FEE_SOURCES.has(source)) return `${pct(FEE_BPS)} Bushido fee, already included in this quote`;
  return 'No Bushido fee on this route';
}
