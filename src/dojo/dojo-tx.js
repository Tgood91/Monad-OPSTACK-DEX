// The steps behind a Dojo button, with every wallet call passed in so the order can be unit-tested:
//   switch to Monad -> dry-run -> sign & send -> wait. The dry-run must pass before the wallet is asked to sign.
import { waitFor } from '../merkl-claim.js';

export async function runDojoTx({
  chainId,
  from,
  tx,
  getChainId,
  switchChain,
  simulate,
  send,
  onStage = () => {},
  sleep,
}) {
  if (Number(await getChainId()) !== chainId) {
    onStage('switch');
    await switchChain(chainId);
    const ok = await waitFor(async () => Number(await getChainId()) === chainId, { sleep });
    if (!ok) throw new Error('Your wallet did not switch to Monad. Switch it manually and try again.');
  }
  onStage('simulate');
  const sim = await simulate({ ...tx, from });
  if (!sim.ok) throw new Error('This would fail on-chain, so nothing was sent. ' + (sim.reason || ''));
  onStage('sign');
  const sent = await send(tx);
  onStage('wait', sent);
  await sent.wait();
  return { hash: sent.hash };
}
