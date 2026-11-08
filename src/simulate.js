// Dry-run a transaction (eth_call) before the wallet is ever asked to sign. Pure logic, providers passed in.
//
// Why several providers: some wallet in-app browsers (Zerion's) refuse eth_call through the wallet's own
// connection and answer with a bare "Call failed". That is the wallet declining to answer, not the swap
// failing. So we ask our public RPC first and only trust a real revert as a "no". If NOBODY can answer, the
// swap is still not sent, but the message says we couldn't check, instead of claiming it would fail.

/** A genuine on-chain revert (as opposed to a refusal, timeout or network error). */
export function isRevert(e) {
  return e?.code === 'CALL_EXCEPTION' || /revert/i.test(String(e?.shortMessage || e?.reason || e?.message || ''));
}

/** The node says this wallet can't cover the amount (plus gas): a real answer about the wallet, not a refusal. */
export function isInsufficientFunds(e) {
  return (
    e?.code === 'INSUFFICIENT_FUNDS' ||
    /insufficient funds|exceeds (the )?balance|insufficient balance/i.test(String(e?.shortMessage || e?.message || ''))
  );
}

export async function runSimulation(providers, { to, data, value, from }) {
  let lastRefusal = 'no answer';
  for (const p of providers) {
    try {
      await p.call({ to, data, value: value ?? 0n, from });
      return { ok: true };
    } catch (e) {
      const reason = String(e?.reason || e?.shortMessage || e?.message || 'simulation reverted').slice(0, 160);
      if (isInsufficientFunds(e))
        return {
          ok: false,
          reverted: false,
          funds: true,
          reason: 'not enough in this wallet to cover this amount plus gas. Try a smaller amount or add funds.',
        };
      if (isRevert(e)) return { ok: false, reverted: true, reason }; // the chain said no: believe it
      lastRefusal = reason; // this provider just couldn't answer: ask the next one
    }
  }
  return {
    ok: false,
    reverted: false,
    reason: `couldn't check this right now (${lastRefusal.slice(0, 60)}). Nothing was sent. Please try again.`,
  };
}
