// Virtue Compass, gated Swap panel and Operations panel for the Bushido tab.
import React, { useEffect, useState } from 'react';
import { CHAINS } from './dex/chains.js';
import { checkSlippage, gateTrade, reportOps } from './bushido-gate.js';

const FIVE = ['gi', 'yu', 'jin', 'rei', 'makoto'];

export function VirtueCompass({ virtues }) {
  const items = FIVE.map((id) => virtues.find((v) => v.id === id)).filter(Boolean);
  if (items.length < 3) return null;
  const R = 70, C = 90, n = items.length;
  const pt = (i, r) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r];
  };
  const ring = (f) => items.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const shape = items.map((v, i) => pt(i, R * Math.max(0.04, Math.min(1, v.score ?? 0))).join(',')).join(' ');
  return (
    <div className="rounded-lg border border-white/10 p-3 mb-6 flex justify-center">
      <svg viewBox="0 0 180 180" width="220" height="220" role="img" aria-label="Virtue Compass">
        {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ring(f)} fill="none" stroke="currentColor" strokeOpacity="0.15" />)}
        {items.map((v, i) => { const [x, y] = pt(i, R + 12); const [lx, ly] = pt(i, R);
          return (<g key={v.id}><line x1={C} y1={C} x2={lx} y2={ly} stroke="currentColor" strokeOpacity="0.15" />
            <text x={x} y={y} fontSize="9" textAnchor="middle" dominantBaseline="middle" fill="currentColor">{v.name}</text></g>); })}
        <polygon points={shape} fill="#f59e0b" fillOpacity="0.3" stroke="#f59e0b" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// ETH -> USDC on Base through the same quote engine as the Swap tab. A trade
// goes out only if slippage is 0.1%-1% AND the dry-run simulation passes.
export function SwapPanel() {
  const chain = CHAINS.base;
  const [amount, setAmount] = useState('0.001');
  const [slip, setSlip] = useState('0.5');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const s = checkSlippage(slip);

  async function run() {
    setBusy(true); setMsg('Quoting…');
    try {
      const [{ quoteAll, buildTxFor }, web3, { ethers }] = await Promise.all([
        import('./dex/engine.js'), import('./utils/web3.js'), import('ethers'),
      ]);
      if (!web3.isConnected()) throw new Error('Connect a wallet first');
      if (web3.getChainKey() !== 'base') await web3.switchNetwork('base');
      const [tIn, tOut] = chain.tokens;
      const wallet = web3.getAddress();
      const amountInWei = ethers.parseUnits(amount, tIn.decimals);
      const sources = chain.sources.filter((x) => x !== 'fusion');
      const r = await quoteAll({ chainKey: 'base', tokenIn: tIn, tokenOut: tOut, amountInWei, wallet, sources, slippageBps: s.bps || 50 });
      if (!r.best) throw new Error('No quote available');
      setMsg('Simulating…');
      const signer = await web3.getSigner();
      const tx = await buildTxFor(r.best.quote, wallet, s.bps, signer);
      const sim = await web3.simulateTx({ to: tx.to, data: tx.data, value: tx.value, from: wallet });
      const gate = gateTrade({ slippagePct: slip, sim });
      if (!gate.allowed) throw new Error(gate.reason);
      setMsg('Confirm in your wallet…');
      const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
      await sent.wait();
      setMsg(`Swapped ✓ via ${r.best.source} — ${sent.hash.slice(0, 10)}…`);
    } catch (e) {
      const m = (e.reason || e.message || 'failed').slice(0, 140);
      setMsg('Blocked: ' + m);
      reportOps(/revert|simulation/i.test(m) ? 'high' : 'warn', 'bushido-swap', m);
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-white/10 p-4 mb-6">
      <div className="font-medium mb-2">Swap ETH → USDC on Base</div>
      <div className="flex gap-2 mb-2">
        <label className="flex-1 text-xs opacity-70">ETH amount
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
            className="w-full mt-1 rounded bg-white/5 border border-white/10 p-2 text-sm" /></label>
        <label className="w-28 text-xs opacity-70">Slippage %
          <input value={slip} onChange={(e) => setSlip(e.target.value)} inputMode="decimal"
            className="w-full mt-1 rounded bg-white/5 border border-white/10 p-2 text-sm" /></label>
      </div>
      {!s.ok && <div className="text-xs text-amber-400 mb-2">{s.reason}</div>}
      <button disabled={busy || !s.ok} onClick={run}
        className="w-full rounded bg-amber-500/90 text-black font-semibold p-2 disabled:opacity-40">
        {busy ? 'Working…' : 'Simulate & swap'}
      </button>
      {msg && <div className="text-xs mt-2 opacity-80">{msg}</div>}
    </div>
  );
}

export function OperationsPanel() {
  const [data, setData] = useState({ entries: [], email: false });
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/ops/log').then((r) => r.json()).then((d) => alive && setData(d)).catch(() => {});
    load(); const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const color = { high: 'text-red-400', warn: 'text-amber-400', info: 'opacity-60' };
  return (
    <div className="rounded-lg border border-white/10 p-4 mt-6">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">Operations</span>
        <span className="text-xs opacity-50">{data.email ? 'email alerts on' : 'email alerts off (no Resend key)'}</span>
      </div>
      {data.entries.length === 0 ? <div className="text-xs opacity-50">No errors logged.</div> :
        <ul className="space-y-1 text-xs">{data.entries.slice(0, 8).map((e, i) => (
          <li key={i} className="flex gap-2"><span className={`${color[e.severity]} w-10 shrink-0`}>{e.severity}</span>
            <span className="opacity-80">{e.message}{e.escalated ? ' ✉' : ''}</span></li>))}</ul>}
    </div>
  );
}
