// Bushido signal logic and the Intel endpoint's answer builder (pure functions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seykotaSignal, listStrategies } from '../server/bushido.js';
import { getDexIntelligenceResponse } from '../server/Dex-intellegence.js';

const rising = Array.from({ length: 60 }, (_, i) => 3000 + i * 5);
const strong = { gi: 0.9, yu: 0.9 };

test('Seykota: fewer than 30 prices -> WAIT (insufficient history)', () => {
  const s = seykotaSignal(rising.slice(0, 10), strong);
  assert.equal(s.signal, 'WAIT');
  assert.match(s.detail, /insufficient/);
});

test('Seykota: neutral virtue scores are gated', () => {
  const s = seykotaSignal(rising, { gi: 0.5, yu: 0.5 });
  assert.equal(s.signal, 'WAIT');
  assert.equal(s.gated, true);
});

test('Seykota: steady uptrend with strong virtues -> long', () => {
  const s = seykotaSignal(rising, strong);
  assert.equal(s.signal, 'HOLD_LONG');
  assert.ok(s.confidence > 0 && s.confidence <= 0.95);
});

test('strategy list includes seykota', () => {
  assert.ok(listStrategies().some(s => s.id === 'seykota'));
});

test('Intel: every answer has a final response and follow-up suggestions', () => {
  for (const q of ['1inch pathfinder', 'aerodrome pools', '0xsplits', 'anything else']) {
    const msgs = getDexIntelligenceResponse(q);
    const texts = msgs.map(m => m.systemMessage.text).filter(Boolean);
    assert.ok(texts.some(t => t.textType === 'FINAL_RESPONSE'), q);
    assert.ok(texts.some(t => !t.textType && t.parts.length), q);
  }
});
