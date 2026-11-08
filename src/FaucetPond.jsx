// "Free starter MON", with the koi pond itself as the button (Rewards tab).
// Tap the pond: it connects your wallet if needed, then checks eligibility and claims. A coin drops in while
// it works and ripples spread when the MON lands. It hides for wallets that already have gas, and is absent
// when the faucet is off. The wording and rules live in faucet-button.js (unit-tested).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import DojoPond from './DojoPond.jsx';
import { faucetBarView, runFaucetClaim } from './faucet-button.js';
import { claimFaucet, loadFaucet } from './dojo/dojo-core.js';
import { openConnect } from './utils/web3.js';
import { CHAINS } from './dex/chains.js';
import { txUrl } from './bushido-links.js';
import { retryOnce } from './utils/retry.js';

const PROBE = '0x000000000000000000000000000000000000dEaD'; // only used to read the drip amount
const PENDING_MS = 2 * 60 * 1000; // a tap on "Connect & claim" stays armed for 2 minutes

const CSS = `
.fp-pond{position:relative;display:block;width:100%;border-radius:10px;outline-offset:3px;-webkit-tap-highlight-color:transparent}
.fp-pond[aria-disabled="false"]{cursor:pointer}
.fp-pond[aria-disabled="false"]:hover{filter:brightness(1.07)}
.fp-pond[aria-disabled="true"]{cursor:default}
.fp-overlay{position:absolute;left:0;right:0;bottom:10px;display:flex;justify-content:center;pointer-events:none}
.fp-label{padding:11px 18px;border-radius:999px;font-weight:700;font-size:15px;color:#fff;max-width:92%;text-align:center;
 background:linear-gradient(248.86deg,#B6509E 10.51%,#177E87 93.41%);box-shadow:0 4px 18px rgba(0,0,0,.45)}
.fp-pond[aria-disabled="true"] .fp-label{background:#2a2a35;color:#d4d4d8}
.fp-pond.sent .fp-label{background:#14532d;color:#bbf7d0}
.fp-coin{position:absolute;left:50%;top:6%;width:22px;height:22px;margin-left:-11px;border-radius:50%;
 background:radial-gradient(circle at 35% 30%,#fde68a,#f59e0b 60%,#b45309);box-shadow:0 0 10px rgba(251,191,36,.8);
 opacity:0;pointer-events:none}
.fp-pond.working .fp-coin{animation:fp-drop 1.1s ease-in infinite}
@keyframes fp-drop{0%{transform:translateY(0) scale(1);opacity:0}15%{opacity:1}80%{transform:translateY(105px) scale(.8);opacity:1}100%{transform:translateY(118px) scale(.5);opacity:0}}
.fp-ring{position:absolute;left:50%;top:56%;width:40px;height:14px;margin-left:-20px;border:2px solid rgba(125,211,252,.85);border-radius:50%;opacity:0;pointer-events:none}
.fp-pond.sent .fp-ring{animation:fp-ripple 1.8s ease-out 3}
.fp-pond.sent .fp-ring:nth-of-type(2){animation-delay:.35s}
@keyframes fp-ripple{0%{transform:scale(.3);opacity:.9}100%{transform:scale(6.5);opacity:0}}
.fp-hint{font-size:12px;margin-top:8px;color:var(--muted);text-align:center}
.fp-hint.ok{color:var(--green)}
.fp-hint.warn{color:#fcd34d}
.fp-hint a{color:#7dd3fc}
@media (prefers-reduced-motion:reduce){.fp-pond.working .fp-coin,.fp-pond.sent .fp-ring{animation:none}}
`;

export default function FaucetPond({ trader }) {
  const [enabled, setEnabled] = useState(false);
  const [dripMon, setDripMon] = useState(null);
  const [status, setStatus] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [userStarted, setUserStarted] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const pendingUntil = useRef(0);
  const traderRef = useRef(trader);
  traderRef.current = trader;

  // Is the faucet on, and how much does it give? (Only a probe address is used: nothing is claimed.)
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const h = await (await fetch('/api/health')).json();
        if (!h?.keys?.faucet) return;
        const p = await loadFaucet(PROBE);
        if (live) {
          setEnabled(true);
          setDripMon(p?.dripMon || null);
        }
      } catch {
        /* faucet unreachable: stay hidden */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const claim = useCallback(async (addr) => {
    setUserStarted(true);
    pendingUntil.current = 0;
    setPhase('checking');
    setError('');
    const r = await runFaucetClaim(addr, { loadFaucet, claimFaucet });
    if (traderRef.current !== addr) return; // they switched wallets meanwhile
    if (r.state === 'sent') {
      setResult({ hash: r.hash, amountMon: r.amountMon });
      setPhase('sent');
      window.dispatchEvent(new CustomEvent('bushido:faucet-sent', { detail: { address: addr } }));
    } else if (r.state === 'error') {
      setError(r.message);
      setPhase('error');
    } else {
      setStatus(r.status);
      setPhase('idle');
    }
  }, []);

  // The wallet changed (connected, switched or disconnected).
  useEffect(() => {
    setStatus(null);
    setResult(null);
    setError('');
    setPhase('idle');
    if (!trader) return;
    if (Date.now() < pendingUntil.current) {
      claim(trader); // they tapped "Connect & claim": finish the job
      return;
    }
    setUserStarted(false);
    retryOnce(() => loadFaucet(trader))
      .then((st) => {
        if (traderRef.current === trader) setStatus(st);
      })
      .catch(() => {});
  }, [trader, claim]);

  const v = faucetBarView({ enabled, dripMon, connected: !!trader, status, phase, userStarted, result, error });
  if (!v.show) return null;

  const press = () => {
    if (v.disabled) return;
    if (!trader) {
      setUserStarted(true);
      pendingUntil.current = Date.now() + PENDING_MS;
      openConnect();
      return;
    }
    claim(trader);
  };
  const working = phase === 'checking' || phase === 'claiming';
  const link = phase === 'sent' && result?.hash ? txUrl(CHAINS.monad, result.hash) : null;

  return (
    <div className="card" data-testid="faucet-pond">
      <style>{CSS}</style>
      <span className="lbl">Free starter MON</span>
      <div
        role="button"
        tabIndex={v.disabled ? -1 : 0}
        aria-disabled={v.disabled}
        aria-label={`${v.label}. Tap the pond.`}
        className={`fp-pond ${working ? 'working' : ''} ${phase === 'sent' ? 'sent' : ''}`}
        onClick={press}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            press();
          }
        }}
      >
        <DojoPond name="A koi pond. Tap it to claim free MON." />
        <span className="fp-coin" />
        <span className="fp-ring" />
        <span className="fp-ring" />
        <span className="fp-overlay">
          <span className="fp-label">{v.label}</span>
        </span>
      </div>
      <div className={`fp-hint ${v.tone}`} aria-live="polite">
        {v.hint}
        {link && (
          <>
            {' '}
            <a href={link} target="_blank" rel="noopener noreferrer">
              View transaction
            </a>
          </>
        )}
      </div>
    </div>
  );
}
