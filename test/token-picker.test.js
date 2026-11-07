import test from 'node:test';
import assert from 'node:assert/strict';
import { readOptions, currentLabel, choose } from '../src/token-picker.js';

const sel = (opts, selected = 0) => {
  const el = {
    options: opts.map(([value, text], i) => ({ value, textContent: text, selected: i === selected, disabled: false })),
    value: opts[selected][0],
    events: [],
    dispatchEvent(e) {
      this.events.push(e.type);
    },
  };
  return el;
};

test('reads the options and the selected label', () => {
  const s = sel([['a', ' MON '], ['b', 'USDC']], 1);
  const o = readOptions(s);
  assert.deepEqual(o.map((x) => x.label), ['MON', 'USDC']);
  assert.equal(currentLabel(o), 'USDC');
});
test('empty select shows a placeholder, not a crash', () => {
  assert.equal(currentLabel(readOptions({ options: [] })), '…');
});
test('choosing sets the value and fires change so the app reacts', () => {
  const s = sel([['a', 'MON'], ['b', 'USDC']]);
  choose(s, 'b', null);
  assert.equal(s.value, 'b');
  assert.deepEqual(s.events, ['change']);
});
