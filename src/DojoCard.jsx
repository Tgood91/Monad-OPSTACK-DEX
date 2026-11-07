// "Your Dojo" card for the top of the Bushido tab: the Dojo Pass and the Warrior (the Dojo pet),
// both read from Monad mainnet. Phase 1: display plus two buttons (get a pass, enter the dojo).
// Nothing here changes a pet's stats (only the contract owner can), and there are no pass perks yet.
import React, { useCallback, useEffect, useState } from 'react';
import { CHAINS } from './dex/chains.js';
import { reportOps } from './bushido-gate.js';
import { DOJO, dojoTx, dojoView, loadDojo } from './dojo/dojo-core.js';
import { runDojoTx } from './dojo/dojo-tx.js';

const MOOD_RING = {
  Radiant: 'ring-emerald-400',
  Ready: 'ring-amber-400',
  Steady: 'ring-sky-400',
  Weary: 'ring-rose-400',
};

export default function DojoCard({ trader }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!trader);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const explorer = CHAINS.monad.explorer;

  const refresh = useCallback(async () => {
    if (!trader) return;
    setLoading(true);
    setError('');
    try {
      setData(await loadDojo(trader));
    } catch (e) {
      setError(String(e.message || e).slice(0, 140));
    } finally {
      setLoading(false);
    }
  }, [trader]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(id) {
    setBusy(true);
    setMsg('');
    try {
      const [web3, cfg] = await Promise.all([import('./utils/web3.js'), import('./config.js')]);
      if (!web3.isConnected()) throw new Error('Connect a wallet first');
      const tx = dojoTx(id, data.fee);
      const say = {
        switch: 'Switching your wallet to Monad…',
        simulate: 'Checking it will succeed…',
        sign: id === 'pass' ? 'Confirm the Dojo Pass in your wallet…' : 'Confirm entering the Dojo in your wallet…',
        wait: 'Sent. Waiting for confirmation…',
      };
      const r = await runDojoTx({
        chainId: DOJO.chainId,
        from: trader,
        tx,
        getChainId: async () => (await web3.getWalletEthersProvider().getNetwork()).chainId,
        switchChain: async (cid) => cfg.appKit.switchNetwork(cfg.appKitNetworkForChainId(cid)),
        simulate: (t) => web3.simulateTx({ to: t.to, data: t.data, value: t.value, from: t.from }),
        send: async (t) => (await web3.getSigner()).sendTransaction({ to: t.to, data: t.data, value: t.value }),
        onStage: (stage) => setMsg(say[stage] || ''),
      });
      setMsg(`Done ✓ ${r.hash.slice(0, 12)}…`);
      await refresh();
    } catch (e) {
      const m = String(e.shortMessage || e.reason || e.message || e).slice(0, 160);
      setMsg('Not sent: ' + m);
      reportOps('warn', 'dojo', m);
    } finally {
      setBusy(false);
    }
  }

  const v = dojoView({ connected: !!trader, loading, error, data });
  const Btn = ({ action, secondary }) => (
    <button
      disabled={busy}
      onClick={() => act(action.id)}
      className={
        secondary
          ? 'w-full rounded border border-amber-400/60 bg-transparent text-amber-300 font-semibold p-2 disabled:opacity-40'
          : 'w-full rounded border-0 bg-amber-500/90 text-black font-semibold p-2 disabled:opacity-40'
      }
    >
      {busy ? 'Working…' : action.label}
    </button>
  );

  return (
    <div className="rounded-lg border border-white/10 p-4 mb-6" data-testid="dojo-card">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold">⛩ Your Dojo</span>
        {v.kind === 'ready' && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${v.pass.has ? 'border-emerald-400/50 text-emerald-300' : 'border-white/20 opacity-70'}`}
          >
            {v.pass.badge}
          </span>
        )}
      </div>

      {v.kind !== 'ready' && (
        <div className={`text-sm ${v.kind === 'error' ? 'text-red-400' : 'opacity-60'}`}>
          {v.message}
          {v.kind === 'error' && (
            <button onClick={refresh} className="ml-2 underline">
              Try again
            </button>
          )}
        </div>
      )}

      {v.kind === 'ready' && (
        <>
          {v.pet.registered ? (
            <div className="flex gap-4 items-center">
              <img
                src="/Bushido-dApp/icons/icon-192.png"
                alt="Your warrior"
                className={`w-20 h-20 rounded-2xl ring-4 ${MOOD_RING[v.pet.mood] || 'ring-white/20'}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">Level {v.pet.level}</span>
                  <span className="text-sm opacity-80">{v.pet.mood}</span>
                </div>
                <div className="text-xs opacity-60 mb-2">
                  {v.pet.days === 0 ? 'Joined today' : `In the dojo ${v.pet.days} day${v.pet.days === 1 ? '' : 's'}`}
                </div>
                {v.pet.meters.map((m) => (
                  <div key={m.label} className="mb-1.5">
                    <div className="flex justify-between text-xs opacity-70">
                      <span>{m.label}</span>
                      <span className="tabular-nums">{m.value}</span>
                    </div>
                    <div className="h-1.5 rounded bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded bg-gradient-to-r from-amber-500 to-emerald-500"
                        style={{ width: `${m.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-sm opacity-70 mb-2">
                You haven't entered the Dojo yet. Each wallet gets one warrior.
              </div>
              <Btn action={v.pet.action} />
            </div>
          )}
          {!v.pass.has && (
            <div className="mt-3">
              <Btn action={v.pass.action} secondary />
            </div>
          )}
        </>
      )}

      {msg && <div className="text-xs mt-2 opacity-80">{msg}</div>}
      <div className="text-[11px] opacity-60 mt-3">
        On Monad ·{' '}
        <a
          className="underline text-sky-300"
          href={`${explorer}/address/${DOJO.pass}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Pass
        </a>
        {' · '}
        <a
          className="underline text-sky-300"
          href={`${explorer}/address/${DOJO.warrior}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Warrior
        </a>
      </div>
    </div>
  );
}
