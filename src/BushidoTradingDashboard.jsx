// BushidoTradingDashboard — wired to live backend.
// Fetches 7-virtue scores + Seykota signals from /api/bushido/*.
// Falls back to neutral display while loading.

import React, { useState, useEffect } from 'react';
import { TrendingUp, Zap, Target, AlertCircle, CheckCircle, ChevronRight } from 'lucide-react';

const API = ''; // same-origin

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `API ${res.status}`);
  return j;
}

const BushidoTradingDashboard = ({ trader }) => {
  const [selectedStrategy, setSelectedStrategy] = useState('seykota');
  const [virtues, setVirtues] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!trader) { setLoading(false); return; }
    (async () => {
      try {
        setLoading(true);
        const [v, s] = await Promise.all([
          api(`/api/bushido/virtues?trader=${trader}`),
          api('/api/bushido/strategies'),
        ]);
        setVirtues(v.virtues || []);
        setSource(v.source || '');
        // Merge live signal state from dashboard endpoint
        const d = await api(`/api/bushido/dashboard?trader=${trader}`);
        setStrategies(d.strategies || s.strategies || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [trader]);

  const virtueScores = Object.fromEntries(virtues.map(v => [v.id, v.score ?? 0.5]));

  if (loading) return <div className="p-6 text-center opacity-60">Loading virtue scores…</div>;
  if (error) return <div className="p-6 text-center text-red-400">Failed to load: {error}</div>;
  if (!trader) return <div className="p-6 text-center opacity-60">Connect a wallet to view virtue scores.</div>;

  const active = strategies.find(s => s.id === selectedStrategy);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Target size={20} /> Bushido Trading Dashboard
        </h2>
        {source && <span className="text-xs opacity-50">scores: {source}</span>}
      </div>

      {/* Virtue scores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {virtues.map(v => (
          <div key={v.id} className="rounded-lg border border-white/10 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold">{v.name}</span>
              <span className="text-sm tabular-nums">{((v.score ?? 0) * 100).toFixed(0)}%</span>
            </div>
            <div className="text-xs opacity-60 mb-2">{v.meaning} · {v.principle}</div>
            <div className="h-1.5 rounded bg-white/10 overflow-hidden">
              <div
                className="h-full rounded bg-gradient-to-r from-amber-500 to-emerald-500"
                style={{ width: `${(v.score ?? 0) * 100}%` }}
              />
            </div>
            {!v.onChain && <div className="text-[10px] opacity-40 mt-1">derived</div>}
          </div>
        ))}
      </div>

      {/* Strategies */}
      <h3 className="font-semibold mb-3 flex items-center gap-2"><Zap size={16} /> Strategies</h3>
      <div className="space-y-2 mb-6">
        {strategies.map(s => (
          <button
            key={s.id}
            onClick={() => setSelectedStrategy(s.id)}
            className={`w-full text-left rounded-lg border p-3 flex items-center justify-between transition ${
              selectedStrategy === s.id ? 'border-amber-500/60 bg-amber-500/5' : 'border-white/10 hover:border-white/25'
            }`}
          >
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-xs opacity-60">{s.theme}</div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {s.status === 'active'
                ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle size={14} /> active</span>
                : s.status === 'gated'
                ? <span className="flex items-center gap-1 text-amber-400"><AlertCircle size={14} /> virtue-gated</span>
                : <span className="opacity-50">waiting</span>}
              <ChevronRight size={14} className="opacity-40" />
            </div>
          </button>
        ))}
      </div>

      {/* Active strategy detail */}
      {active && (
        <div className="rounded-lg border border-white/10 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} />
            <span className="font-medium">{active.name} — latest signal</span>
          </div>
          <div className="text-sm opacity-80">{active.lastSignal}</div>
          {typeof active.confidence === 'number' && active.confidence > 0 && (
            <div className="text-sm mt-1">Confidence: <span className="tabular-nums font-medium">{(active.confidence * 100).toFixed(0)}%</span></div>
          )}
        </div>
      )}
    </div>
  );
};

export default BushidoTradingDashboard;
