// Virtue Compass, gated Swap panel and Operations panel for the Bushido tab.
import React, { useEffect, useState } from 'react';
import { CHAINS } from './dex/chains.js';
import { checkSlippage, gateTrade, reportOps } from './bushido-gate.js';
import { FALLBACK_CHAIN, swapSetup, switchAndConfirm } from './bushido-swap.js';
import { BUSHIDO_REPOS, txUrl } from './bushido-links.js';

const FIVE = ['gi', 'yu', 'jin', 'rei', 'makoto'];

export function VirtueCompass({ virtues }) {
  const items = FIVE.map((id) => virtues.find((v) => v.id === id)).filter(Boolean);
  if (items.length < 3) return null;
  const R = 70,
    C = 90,
    n = items.length;
  const pt = (i, r) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r];
  };
  const ring = (f) => items.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const shape = items.map((v, i) => pt(i, R * Math.max(0.04, Math.min(1, v.score ?? 0))).join(',')).join(' ');
  return (
    <div className="rounded-lg border border-white/10 p-3 mb-6 flex justify-center">
      <svg viewBox="0 0 180 180" width="220" height="220" role="img" aria-label="Virtue Compass">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={ring(f)} fill="none" stroke="currentColor" strokeOpacity="0.15" />
        ))}
        {items.map((v, i) => {
          const [x, y] = pt(i, R + 12);
          const [lx, ly] = pt(i, R);
          return (
            <g key={v.id}>
              <line x1={C} y1={C} x2={lx} y2={ly} stroke="currentColor" strokeOpacity="0.15" />
              <text x={x} y={y} fontSize="9" textAnchor="middle" dominantBaseline="middle" fill="currentColor">
                {v.name}
              </text>
            </g>
          );
        })}
        <polygon points={shape} fill="#f59e0b" fillOpacity="0.3" stroke="#f59e0b" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// Native coin -> USDC on the chain you pick (it follows your wallet, or starts on Monad), through the same
// quote engine as the Swap tab. A trade goes out only if slippage is 0.1%-1% AND the dry-run simulation passes.
export function SwapPanel() {
  const [chainKey, setChainKey] = useState(FALLBACK_CHAIN);
  const setup = swapSetup(chainKey);
  const [amount, setAmount] = useState(setup.defaultAmount);
  const [slip, setSlip] = useState('0.5');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { hash, url } of the last swap, so the hash is a real link
  const s = checkSlippage(slip);

  // Start on the wallet's chain if the app supports it, and follow it when the wallet changes network.
  useEffect(() => {
    let off = () => {};
    let alive = true;
    import('./utils/web3.js')
      .then((web3) => {
        if (!alive) return;
        // Ask the wallet itself which chain it is on: AppKit's own answer can be stale in wallet in-app browsers.
        const follow = async () => {
          if (!web3.isConnected()) return;
          const k = await web3.getWalletChainKey();
          if (alive && k && CHAINS[k]) pickAndSet(k);
        };
        follow();
        const unsub = web3.subscribeToNetworkChanges(follow);
        const onShow = () => document.visibilityState !== 'hidden' && follow();
        document.addEventListener('visibilitychange', onShow);
        off = () => {
          if (typeof unsub === 'function') unsub();
          document.removeEventListener('visibilitychange', onShow);
        };
      })
      .catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, []);

  function pickAndSet(k) {
    setChainKey((prev) => {
      if (prev !== k) setAmount(swapSetup(k).defaultAmount);
      return k;
    });
  }

  async function choose(k) {
    pickAndSet(k);
    setMsg('');
    try {
      const web3 = await import('./utils/web3.js');
      if (!web3.isConnected()) return;
      setMsg(`Switching your wallet to ${CHAINS[k].label}…`);
      await switchAndConfirm({
        chainKey: k,
        label: CHAINS[k].label,
        getChainKey: web3.getWalletChainKey,
        switchNetwork: web3.switchNetwork,
      });
      setMsg('');
    } catch (e) {
      setMsg('Not switched: ' + String(e.shortMessage || e.reason || e.message || e).slice(0, 140));
    }
  }

  async function run() {
    let simResult = null; // kept so the Operations log only says "high" for a REAL on-chain revert
    setBusy(true);
    setDone(null);
    setMsg('Quoting…');
    try {
      const [{ quoteAll, buildTxFor }, web3, { ethers }] = await Promise.all([
        import('./dex/engine.js'),
        import('./utils/web3.js'),
        import('ethers'),
      ]);
      if (!web3.isConnected()) throw new Error('Connect a wallet first');
      await switchAndConfirm({
        chainKey,
        label: setup.chain.label,
        getChainKey: web3.getWalletChainKey,
        switchNetwork: web3.switchNetwork,
      });
      const wallet = web3.getAddress();
      const amountInWei = ethers.parseUnits(amount, setup.tIn.decimals);
      const r = await quoteAll({
        chainKey,
        tokenIn: setup.tIn,
        tokenOut: setup.tOut,
        amountInWei,
        wallet,
        sources: setup.sources,
        slippageBps: s.bps || 50,
      });
      if (!r.best) throw new Error('No quote available');
      setMsg('Simulating…');
      const signer = await web3.getSigner();
      const tx = await buildTxFor(r.best.quote, wallet, s.bps, signer);
      const sim = await web3.simulateTx({ to: tx.to, data: tx.data, value: tx.value, from: wallet });
      simResult = sim;
      const gate = gateTrade({ slippagePct: slip, sim });
      if (!gate.allowed) throw new Error(gate.reason);
      setMsg('Confirm in your wallet…');
      const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
      await sent.wait();
      setMsg(`Swapped ✓ via ${r.best.source} — `);
      setDone({ hash: sent.hash, url: txUrl(setup.chain, sent.hash) });
    } catch (e) {
      const m = (e.reason || e.message || 'failed').slice(0, 140);
      setMsg('Blocked: ' + m);
      // Only a genuine revert is "high". A refusal, a missing balance or a flaky read is just a warning.
      reportOps(simResult?.reverted ? 'high' : 'warn', 'bushido-swap', m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/10 p-4 mb-6" data-testid="bushido-swap">
      <div className="font-medium mb-2">{setup.title}</div>
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Chain">
        {Object.keys(CHAINS).map((k) => (
          <button
            key={k}
            disabled={busy}
            onClick={() => choose(k)}
            aria-pressed={k === chainKey}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              k === chainKey
                ? 'border-amber-400 bg-amber-400/10 text-white'
                : 'border-white/15 bg-transparent opacity-70'
            }`}
          >
            {CHAINS[k].label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mb-2">
        <label className="flex-1 min-w-0 text-xs opacity-70">
          {setup.amountLabel}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="box-border w-full mt-1 rounded bg-white/5 border border-white/10 p-2 text-sm text-white"
          />
        </label>
        <label className="w-24 shrink-0 text-xs opacity-70">
          Slippage %
          <input
            value={slip}
            onChange={(e) => setSlip(e.target.value)}
            inputMode="decimal"
            className="box-border w-full mt-1 rounded bg-white/5 border border-white/10 p-2 text-sm text-white"
          />
        </label>
      </div>
      {!s.ok && <div className="text-xs text-amber-400 mb-2">{s.reason}</div>}
      <button
        disabled={busy || !s.ok}
        onClick={run}
        className="w-full rounded border-0 bg-amber-500/90 text-black font-semibold p-2 disabled:opacity-40"
      >
        {busy ? 'Working…' : 'Simulate & swap'}
      </button>
      {msg && (
        <div className="text-xs mt-2 opacity-80">
          {msg}
          {done &&
            (done.url ? (
              <a href={done.url} target="_blank" rel="noopener noreferrer" className="underline text-sky-300">
                {done.hash.slice(0, 10)}…
              </a>
            ) : (
              `${done.hash.slice(0, 10)}…`
            ))}
        </div>
      )}
      <div className="text-[11px] opacity-60 mt-3">
        Bushido code on GitHub:{' '}
        {BUSHIDO_REPOS.map((r, i) => (
          <span key={r.name}>
            {i > 0 && ' · '}
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline text-sky-300">
              {r.name}
            </a>
          </span>
        ))}
      </div>
    </div>
  );
}

export function OperationsPanel() {
  const [data, setData] = useState({ entries: [], email: false });
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/ops/log')
        .then((r) => r.json())
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const color = { high: 'text-red-400', warn: 'text-amber-400', info: 'opacity-60' };
  return (
    <div className="rounded-lg border border-white/10 p-4 mt-6">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">Operations</span>
        <span className="text-xs opacity-50">
          {data.email ? 'email alerts on' : 'email alerts off (no Resend key)'}
        </span>
      </div>
      {data.entries.length === 0 ? (
        <div className="text-xs opacity-50">No errors logged.</div>
      ) : (
        <ul className="space-y-1 text-xs">
          {data.entries.slice(0, 8).map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className={`${color[e.severity]} w-10 shrink-0`}>{e.severity}</span>
              <span className="opacity-80">
                {e.message}
                {e.escalated ? ' ✉' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
