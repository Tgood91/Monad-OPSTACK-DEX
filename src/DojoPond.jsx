// The Dojo garden: a quiet Meiji-era (late 1800s Japan) pond scene, drawn as inline SVG so it needs no
// image files. It reflects the warrior: more koi as the stage rises, the stone lantern glows once you have
// bowed today, and the maple turns with the streak. Decoration only: nothing here touches a wallet.
import React from 'react';

const KOI = [
  { x: 118, y: 150, flip: false, c: '#f97316' },
  { x: 205, y: 165, flip: true, c: '#fafafa' },
  { x: 150, y: 175, flip: false, c: '#ef4444' },
  { x: 235, y: 148, flip: true, c: '#fbbf24' },
  { x: 90, y: 172, flip: true, c: '#f97316' },
];

function Koi({ x, y, flip, c }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <ellipse cx="0" cy="0" rx="11" ry="4.5" fill={c} opacity="0.95" />
      <path d="M-10 0 L-18 -4 L-17 4 Z" fill={c} opacity="0.85" />
      <circle cx="7" cy="-1" r="0.9" fill="#111" />
      <animateTransform
        attributeName="transform"
        type="translate"
        additive="sum"
        values="0 0; 6 -1; 0 0; -6 1; 0 0"
        dur={`${7 + (x % 5)}s`}
        repeatCount="indefinite"
      />
    </g>
  );
}

export default function DojoPond({ stageIndex = 0, bowed = false, streak = 0, name = '', children }) {
  const koi = KOI.slice(0, Math.min(KOI.length, stageIndex + 1));
  const leaf = streak >= 7 ? '#dc2626' : streak >= 3 ? '#f97316' : '#65a30d'; // maple turns with the streak
  return (
    <div className="relative rounded-lg overflow-hidden mb-3" style={{ background: '#0b1220' }} data-testid="dojo-pond">
      <svg viewBox="0 0 320 210" className="w-full block" role="img" aria-label={`The dojo garden. ${name}`}>
        <defs>
          <linearGradient id="dp-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1e293b" />
            <stop offset="1" stopColor="#7c4a3a" />
          </linearGradient>
          <linearGradient id="dp-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1d4d5c" />
            <stop offset="1" stopColor="#0f2a36" />
          </linearGradient>
        </defs>
        {/* evening sky, low sun and far hills */}
        <rect width="320" height="110" fill="url(#dp-sky)" />
        <circle cx="255" cy="62" r="17" fill="#fde68a" opacity="0.85" />
        <path d="M0 98 Q50 62 105 92 T215 84 T320 96 V112 H0 Z" fill="#1f2a3a" />
        {/* torii gate */}
        <g fill="#b91c1c">
          <rect x="32" y="56" width="5" height="52" />
          <rect x="82" y="56" width="5" height="52" />
          <rect x="24" y="50" width="71" height="6" rx="2" />
          <rect x="30" y="64" width="59" height="4" />
        </g>
        <rect x="20" y="47" width="79" height="4" rx="2" fill="#7f1d1d" />
        {/* sloped-roof dojo hall */}
        <g>
          <rect x="228" y="76" width="64" height="32" fill="#3b2a20" />
          <path d="M218 78 L260 56 L302 78 Z" fill="#1f2937" />
          <rect x="248" y="88" width="24" height="20" fill="#fbbf24" opacity="0.5" />
        </g>
        {/* pond */}
        <ellipse cx="160" cy="160" rx="150" ry="46" fill="url(#dp-water)" />
        <ellipse cx="160" cy="160" rx="150" ry="46" fill="none" stroke="#475569" strokeWidth="3" opacity="0.7" />
        {/* lily pads */}
        <g fill="#4d7c0f" opacity="0.9">
          <ellipse cx="70" cy="150" rx="9" ry="3.5" />
          <ellipse cx="262" cy="170" rx="8" ry="3" />
          <ellipse cx="190" cy="186" rx="7" ry="2.5" />
        </g>
        <circle cx="70" cy="148" r="2" fill="#f9a8d4" />
        {/* ripples */}
        <g fill="none" stroke="#7dd3fc" opacity="0.35">
          <ellipse cx="170" cy="158" rx="14" ry="4">
            <animate attributeName="rx" values="6;22;6" dur="6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0;0.5" dur="6s" repeatCount="indefinite" />
          </ellipse>
        </g>
        {koi.map((k, i) => (
          <Koi key={i} {...k} />
        ))}
        {/* arched wooden bridge */}
        <g>
          <path d="M104 140 Q160 108 216 140" fill="none" stroke="#7c2d12" strokeWidth="7" strokeLinecap="round" />
          <path d="M104 134 Q160 102 216 134" fill="none" stroke="#b91c1c" strokeWidth="2.5" />
          <line x1="125" y1="124" x2="125" y2="136" stroke="#b91c1c" strokeWidth="2" />
          <line x1="160" y1="118" x2="160" y2="130" stroke="#b91c1c" strokeWidth="2" />
          <line x1="195" y1="124" x2="195" y2="136" stroke="#b91c1c" strokeWidth="2" />
        </g>
        {/* ishidōrō stone lantern, glows once you have bowed today */}
        <g transform="translate(44 150)">
          {bowed && <circle cx="0" cy="-22" r="22" fill="#fbbf24" opacity="0.22" />}
          <rect x="-4" y="-6" width="8" height="18" fill="#6b7280" />
          <rect x="-9" y="-14" width="18" height="9" fill="#4b5563" />
          <rect x="-4" y="-12" width="8" height="5" fill={bowed ? '#fde047' : '#1f2937'} />
          <path d="M-13 -14 L0 -24 L13 -14 Z" fill="#6b7280" />
          <rect x="-8" y="10" width="16" height="4" fill="#4b5563" />
        </g>
        {/* maple, colour follows the streak */}
        <g transform="translate(284 128)">
          <rect x="-2" y="-4" width="4" height="30" fill="#44302a" />
          <circle cx="-8" cy="-12" r="13" fill={leaf} opacity="0.92" />
          <circle cx="9" cy="-8" r="12" fill={leaf} opacity="0.85" />
          <circle cx="0" cy="-22" r="11" fill={leaf} opacity="0.95" />
        </g>
        {/* a few falling petals */}
        <g fill="#fbcfe8" opacity="0.8">
          <circle cx="140" cy="20" r="1.6">
            <animate attributeName="cy" values="10;200" dur="14s" repeatCount="indefinite" />
            <animate attributeName="cx" values="140;165;145" dur="14s" repeatCount="indefinite" />
          </circle>
          <circle cx="230" cy="10" r="1.4">
            <animate attributeName="cy" values="0;190" dur="11s" repeatCount="indefinite" />
            <animate attributeName="cx" values="230;210;235" dur="11s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>
      {children}
    </div>
  );
}
