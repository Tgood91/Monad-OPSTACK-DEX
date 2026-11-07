// The Merkl claim steps, with every wallet/network call passed in so the order of
// steps can be unit-tested without a wallet:
//   build (live proofs) -> switch chain -> simulate -> sign & send -> wait.
// The simulation is a dry-run that must pass before the wallet is asked to sign.

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `check()` until it returns true, or give up after `tries` polls. */
export async function waitFor(check, { tries = 20, ms = 400, sleep = defaultSleep } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return true;
    await sleep(ms);
  }
  return false;
}

export async function runClaim({ chainId, address, fetchClaim, getChainId, switchChain, simulate, send, onStage = () => {}, sleep }) {
  onStage('build');
  const j = await fetchClaim(address, chainId);
  if (!j.claimable) return { claimed: false, reason: j.reason || 'Nothing claimable right now.' };

  if (Number(await getChainId()) !== chainId) {
    onStage('switch', j);
    await switchChain(chainId);
    const ok = await waitFor(async () => Number(await getChainId()) === chainId, { sleep });
    if (!ok) throw new Error('Your wallet did not switch networks. Switch it manually and try again.');
  }

  onStage('simulate', j);
  const sim = await simulate({ to: j.to, data: j.data, from: address });
  if (!sim.ok) throw new Error('Simulation reverted: the rewards may have just been claimed or the claim data changed. ' + (sim.reason || ''));

  onStage('sign', j);
  const tx = await send({ to: j.to, data: j.data });
  onStage('wait', j, tx);
  await tx.wait();
  return { claimed: true, tokens: j.tokens, totalUsd: j.totalUsd, hash: tx.hash };
}
