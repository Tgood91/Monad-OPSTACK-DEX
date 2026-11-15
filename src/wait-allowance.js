// Wait for a token approval to be visible on the chain we read from.
// The wallet's RPC and our public RPC can be a block apart, so "approval confirmed" in the wallet does not yet mean
// our next read or dry-run sees it. Poll until the allowance covers the amount, or give up quietly after `tries`.
// `read` returns the current allowance (bigint). Resolves true when it covers `amount`, false if it never did.
export async function waitForAllowance(read, amount, { tries = 12, delayMs = 1500, sleep, onTick } = {}) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const want = BigInt(amount);
  for (let i = 0; i < tries; i++) {
    try {
      if (BigInt(await read()) >= want) return true;
    } catch {
      /* a failed read is a glitch, not a refusal: try again */
    }
    if (onTick) onTick(i + 1, tries);
    if (i < tries - 1) await pause(delayMs);
  }
  return false;
}
