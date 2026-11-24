// Our own coin / chain picker, as a bottom sheet. Native <select> pop-ups never open in some wallet in-app
// browsers (Zerion's, for one): you tap the pill, it highlights, and nothing drops down. So each <select> stays
// in the page as the single source of truth (the rest of the app keeps reading and writing it), but is hidden,
// and a button opens a list we draw ourselves. Pure helpers are exported for tests.

/** What the list shows, read from a <select>. */
export function readOptions(select) {
  return Array.from(select.options || []).map((o) => ({
    value: o.value,
    label: (o.textContent || o.label || o.value || '').trim(),
    selected: !!o.selected,
    disabled: !!o.disabled,
  }));
}

export const currentLabel = (opts) => (opts.find((o) => o.selected) || opts[0] || { label: '…' }).label;

/** Pick an option the way a user would: set the value, then fire `change` so the app reacts as before. */
export function choose(select, value, doc = globalThis.document) {
  select.value = value;
  select.dispatchEvent(new (doc?.defaultView?.Event || Event)('change', { bubbles: true }));
}

import { backLayer } from './android-app.js';

const CSS_CLASS = 'pick';

/**
 * Open the slide-up list. `items` = [{ value, label, selected?, disabled?, color? }]; `onPick(value)` runs on a tap.
 * Shared by the coin/chain dropdown replacements and the chain menu. `color` draws a small dot (chain colours).
 */
/** Search a long list: every typed word must appear in the label (any case). */
export function filterItems(items, query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return items;
  return items.filter((o) => words.every((w) => String(o.label).toLowerCase().includes(w)));
}

/** Lists longer than this get a search box. */
export const SEARCH_FROM = 12;

export function openChoiceSheet(doc, { title, items, onPick }) {
  const wrap = doc.createElement('div');
  wrap.className = 'pickWrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  const shut = () => {
    wrap.remove();
    doc.removeEventListener('keydown', onKey);
  };
  // In the Android app, the Back button closes the sheet; closing it here also drops that Back step.
  const release = backLayer(shut);
  const close = () => {
    shut();
    release();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  doc.addEventListener('keydown', onKey);
  const back = doc.createElement('div');
  back.className = 'pickBack';
  back.addEventListener('click', close);
  const sheet = doc.createElement('div');
  sheet.className = 'pickSheet';
  const head = doc.createElement('div');
  head.className = 'pickHead';
  head.textContent = title || 'Choose';
  const x = doc.createElement('button');
  x.type = 'button';
  x.className = 'pickX';
  x.setAttribute('aria-label', 'Close');
  x.textContent = '×';
  x.addEventListener('click', close);
  head.appendChild(x);
  const list = doc.createElement('div');
  list.className = 'pickList';
  const draw = (shown) => {
    list.textContent = '';
    for (const o of shown) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'pickItem' + (o.selected ? ' on' : '');
      if (o.color) {
        const dot = doc.createElement('span');
        dot.className = 'pickDot';
        dot.style.background = o.color;
        b.appendChild(dot);
      }
      b.appendChild(doc.createTextNode(o.label));
      b.disabled = !!o.disabled;
      b.addEventListener('click', () => {
        close();
        onPick(o.value);
      });
      list.appendChild(b);
    }
    if (!shown.length) {
      const none = doc.createElement('div');
      none.className = 'pickNone';
      none.textContent = 'No match';
      list.appendChild(none);
    }
  };
  draw(items);
  sheet.appendChild(head);
  if (items.length > SEARCH_FROM) {
    const find = doc.createElement('input');
    find.type = 'search';
    find.className = 'pickFind';
    find.placeholder = 'Search';
    find.setAttribute('aria-label', 'Search the list');
    find.addEventListener('input', () => draw(filterItems(items, find.value)));
    sheet.appendChild(find);
  }
  sheet.appendChild(list);
  wrap.append(back, sheet);
  doc.body.appendChild(wrap);
}

function openSheet(select, title) {
  const doc = select.ownerDocument;
  openChoiceSheet(doc, {
    title,
    items: readOptions(select),
    onPick: (value) => choose(select, value, doc),
  });
}

/** Replace one <select>'s pop-up with our sheet. Safe to call twice. */
export function enhanceSelect(select) {
  if (!select || select.dataset.picker) return;
  select.dataset.picker = '1';
  const doc = select.ownerDocument;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = `${select.className} ${CSS_CLASS}`.trim();
  btn.setAttribute('aria-haspopup', 'dialog');
  const title = select.getAttribute('aria-label') || '';
  const paint = () => {
    btn.textContent = currentLabel(readOptions(select));
    btn.setAttribute('aria-label', `${title || 'Choose'}: ${btn.textContent}`);
  };
  btn.addEventListener('click', () => openSheet(select, title));
  select.style.display = 'none';
  select.after(btn);
  paint();
  // The app fills options and sets .value from code, which fires no event: repaint on all three.
  select.addEventListener('change', paint);
  new (doc.defaultView?.MutationObserver || MutationObserver)(paint).observe(select, { childList: true, subtree: true });
  const proto = Object.getPrototypeOf(select);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'value');
  if (desc?.set) {
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() {
        return desc.get.call(this);
      },
      set(v) {
        desc.set.call(this, v);
        paint();
      },
    });
  }
}

export function enhanceAllSelects(root = globalThis.document) {
  root?.querySelectorAll?.('select.token-select, select.chain-select').forEach(enhanceSelect);
}
